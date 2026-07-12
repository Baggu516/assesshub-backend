import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { extractTextFromFile, detectFileType } from './kb.extract.js';
import { chunkText } from './kb.chunk.js';
import {
  embedTexts,
  embedText,
  cosineSimilarity,
  embeddingProviderConfigured,
  resolveEmbeddingModel,
} from './kb.embed.js';
import { EMBEDDING_PROVIDERS } from '../../models/KnowledgeBaseConfig.js';
import { EMBEDDING_MODEL_OPTIONS, DEFAULT_EMBEDDING_MODEL } from './kb.constants.js';
import {
  DEFAULT_CHUNKING,
  normalizeChunkingConfig,
  resolveChunkingParams,
  serializeChunkingSettings,
} from './kb.config.util.js';
import { projectUploadsPath } from '../../utils/writableDir.js';
import {
  enrichmentAvailable,
  generateDocumentSummary,
  generateSyntheticQuestions,
} from './kb.enrich.js';

export const KB_UPLOAD_ROOT = projectUploadsPath('kb');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function orgOid(orgId) {
  return new mongoose.Types.ObjectId(String(orgId));
}

export async function ensureKbUploadDir(orgId) {
  const dir = path.join(KB_UPLOAD_ROOT, String(orgId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function serializeConfig(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...serializeChunkingSettings(o),
    embeddingProvider: o.embeddingProvider,
    embeddingModel: o.embeddingModel,
    updatedAt: o.updatedAt,
  };
}

export async function getOrCreateKbConfig(models, orgId) {
  const { KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  let doc = await KnowledgeBaseConfig.findOne({ orgId: oid });
  if (!doc) {
    doc = await KnowledgeBaseConfig.create({
      orgId: oid,
      ...DEFAULT_CHUNKING,
      chunkingStrategy: 'semantic',
      chunkSize: 500,
      chunkOverlap: 50,
      embeddingProvider: 'gemini',
      embeddingModel: DEFAULT_EMBEDDING_MODEL.gemini,
    });
  }
  return serializeConfig(doc);
}

export async function updateKbConfig(models, orgId, patch) {
  const { KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  const existing = await KnowledgeBaseConfig.findOne({ orgId: oid }).lean();
  const merged = normalizeChunkingConfig({ ...existing, ...patch });
  const { strategy, chunkSize, chunkOverlap } = resolveChunkingParams(merged);
  const set = {
    ...patch,
    ...serializeChunkingSettings(merged),
    chunkingStrategy: strategy,
    chunkSize,
    chunkOverlap,
  };
  const doc = await KnowledgeBaseConfig.findOneAndUpdate(
    { orgId: oid },
    { $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return serializeConfig(doc);
}

export function getKbMeta() {
  return {
    chunkingDefaults: DEFAULT_CHUNKING,
    enrichmentAvailable: enrichmentAvailable(),
    embeddingProviders: EMBEDDING_PROVIDERS,
    embeddingModels: EMBEDDING_MODEL_OPTIONS,
    providersAvailable: Object.fromEntries(
      EMBEDDING_PROVIDERS.map((p) => [p, embeddingProviderConfigured(p)])
    ),
  };
}

function serializeDocument(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id),
    originalName: o.originalName,
    fileType: o.fileType,
    mimeType: o.mimeType,
    fileSize: o.fileSize,
    status: o.status,
    errorMessage: o.errorMessage || '',
    extractedCharCount: o.extractedCharCount,
    chunkCount: o.chunkCount,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export async function listKbDocuments(models, orgId) {
  const { KnowledgeDocument } = models;
  const rows = await KnowledgeDocument.find({ orgId: orgOid(orgId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return rows.map(serializeDocument);
}

async function processDocument(models, orgId, documentId) {
  const { KnowledgeDocument, KnowledgeChunk, KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  const doc = await KnowledgeDocument.findOne({ _id: documentId, orgId: oid });
  if (!doc) return;

  const config =
    (await KnowledgeBaseConfig.findOne({ orgId: oid }).lean()) ||
    ({
      ...DEFAULT_CHUNKING,
      embeddingProvider: 'gemini',
      embeddingModel: DEFAULT_EMBEDDING_MODEL.gemini,
    });
  const chunking = normalizeChunkingConfig(config);

  if (
    !EMBEDDING_PROVIDERS.includes(config.embeddingProvider) ||
    !embeddingProviderConfigured(config.embeddingProvider)
  ) {
    doc.status = 'failed';
    doc.errorMessage = `Embedding provider "${config.embeddingProvider}" is not supported or not configured on the server`;
    await doc.save();
    return;
  }

  try {
    doc.status = 'processing';
    doc.errorMessage = '';
    await doc.save();

    const text = await extractTextFromFile(doc.storagePath, doc.fileType);
    if (!text || text.length < 10) {
      throw new Error('No extractable text found in file');
    }

    const { strategy, chunkSize, chunkOverlap } = resolveChunkingParams(config);
    const contentChunks = chunkText(text, strategy, chunkSize, chunkOverlap);

    if (!contentChunks.length) {
      throw new Error('Chunking produced no segments');
    }

    await KnowledgeChunk.deleteMany({ orgId: oid, documentId: doc._id });

    const segments = contentChunks.map((t) => ({ text: t, chunkKind: 'content' }));

    const canEnrich = enrichmentAvailable() && !chunking.sourceOnlyMode;
    if (canEnrich && chunking.autoSummary) {
      const summary = await generateDocumentSummary(text, doc.originalName);
      if (summary) {
        segments.unshift({ text: `[Document summary] ${summary}`, chunkKind: 'summary' });
      }
    }
    if (canEnrich && chunking.syntheticQuestions) {
      const questions = await generateSyntheticQuestions(text, doc.originalName);
      for (const q of questions) {
        segments.push({ text: q, chunkKind: 'synthetic_question' });
      }
    }

    const model = resolveEmbeddingModel(config.embeddingProvider, config.embeddingModel);
    const batchSize = 8;
    const chunkDocs = [];

    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const texts = batch.map((s) => s.text);
      const vectors = await embedTexts(config.embeddingProvider, model, texts);
      for (let j = 0; j < batch.length; j++) {
        chunkDocs.push({
          orgId: oid,
          documentId: doc._id,
          chunkIndex: i + j,
          chunkKind: batch[j].chunkKind,
          text: batch[j].text,
          embedding: vectors[j],
        });
      }
    }

    await KnowledgeChunk.insertMany(chunkDocs);

    doc.status = 'ready';
    doc.extractedCharCount = text.length;
    doc.chunkCount = segments.length;
    doc.errorMessage = '';
    await doc.save();
  } catch (err) {
    doc.status = 'failed';
    doc.errorMessage = err.message || 'Processing failed';
    await doc.save();
  }
}

export async function ingestKbDocument(models, orgId, userId, file) {
  const { KnowledgeDocument } = models;
  const fileType = detectFileType(file.originalname, file.mimetype);
  if (!fileType) {
    throw httpError(400, 'Unsupported file type. Use PDF, DOCX, HTML, or TXT.');
  }

  const oid = orgOid(orgId);
  const count = await KnowledgeDocument.countDocuments({ orgId: oid });
  if (count >= 50) {
    throw httpError(400, 'Maximum 50 knowledge-base documents per organization');
  }

  const uploadDir = await ensureKbUploadDir(orgId);
  const docId = new mongoose.Types.ObjectId();
  const ext = path.extname(file.originalname) || `.${fileType}`;
  const dest = path.join(uploadDir, `${String(docId)}${ext}`);

  try {
    await fs.rename(file.path, dest);
  } catch (err) {
    throw httpError(500, err.message || 'Failed to store uploaded file');
  }

  let doc;
  try {
    doc = await KnowledgeDocument.create({
      _id: docId,
      orgId: oid,
      uploadedBy: userId,
      originalName: file.originalname,
      mimeType: file.mimetype || '',
      fileType,
      storagePath: dest,
      fileSize: file.size,
      status: 'pending',
    });
  } catch (err) {
    await fs.unlink(dest).catch(() => {});
    throw err;
  }

  setImmediate(() => {
    processDocument(models, orgId, doc._id).catch((e) => console.error('KB process error', e));
  });

  return serializeDocument(doc);
}

export async function deleteKbDocument(models, orgId, documentId) {
  const { KnowledgeDocument, KnowledgeChunk } = models;
  const oid = orgOid(orgId);
  const doc = await KnowledgeDocument.findOne({ _id: documentId, orgId: oid });
  if (!doc) throw httpError(404, 'Document not found');

  await KnowledgeChunk.deleteMany({ orgId: oid, documentId: doc._id });
  try {
    await fs.unlink(doc.storagePath);
  } catch {
    /* file may already be gone */
  }
  await doc.deleteOne();
}

export async function reprocessKbDocument(models, orgId, documentId) {
  const { KnowledgeDocument } = models;
  const oid = orgOid(orgId);
  const doc = await KnowledgeDocument.findOne({ _id: documentId, orgId: oid });
  if (!doc) throw httpError(404, 'Document not found');

  doc.status = 'pending';
  doc.errorMessage = '';
  await doc.save();

  setImmediate(() => {
    processDocument(models, orgId, doc._id).catch((e) => console.error('KB reprocess error', e));
  });

  return serializeDocument(doc);
}

const TOP_K = 6;
const LOW_CONFIDENCE = 0.35;
const MIN_RELEVANCE = 0.05;

/** Embedding settings for this tenant (saved config or first provider with an API key). */
async function getEmbeddingConfigForOrg(models, orgId) {
  const { KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  const saved = await KnowledgeBaseConfig.findOne({ orgId: oid }).lean();
  if (
    saved?.embeddingProvider &&
    EMBEDDING_PROVIDERS.includes(saved.embeddingProvider) &&
    embeddingProviderConfigured(saved.embeddingProvider)
  ) {
    return saved;
  }
  const fallback = EMBEDDING_PROVIDERS.find((p) => embeddingProviderConfigured(p));
  if (!fallback) return null;
  return {
    embeddingProvider: fallback,
    embeddingModel: DEFAULT_EMBEDDING_MODEL[fallback],
  };
}

/** Whether this tenant has indexed knowledge (visible to any user in the org). */
export async function getKnowledgeBaseStatus(models, orgId) {
  const { KnowledgeChunk, KnowledgeDocument } = models;
  const oid = orgOid(orgId);
  const [readyDocuments, chunkCount, config] = await Promise.all([
    KnowledgeDocument.countDocuments({ orgId: oid, status: 'ready' }),
    KnowledgeChunk.countDocuments({ orgId: oid, 'embedding.0': { $exists: true } }),
    getEmbeddingConfigForOrg(models, orgId),
  ]);
  return {
    available: chunkCount > 0 && Boolean(config),
    readyDocuments,
    chunkCount,
    embeddingProvider: config?.embeddingProvider ?? null,
  };
}

/**
 * Retrieve relevant KB snippets for AI chat.
 * Scoped by orgId only — every user in the tenant shares the same org knowledge base.
 */
export async function retrieveKnowledgeContext(models, orgId, query) {
  const { KnowledgeChunk, KnowledgeDocument } = models;
  const trimmed = (query || '').trim();
  if (!trimmed) return '';

  const oid = orgOid(orgId);
  const config = await getEmbeddingConfigForOrg(models, orgId);
  if (!config) return '';

  const chunkCount = await KnowledgeChunk.countDocuments({
    orgId: oid,
    'embedding.0': { $exists: true },
  });
  if (!chunkCount) return '';

  const provider = config.embeddingProvider;
  const model = resolveEmbeddingModel(provider, config.embeddingModel);
  let queryVec;
  try {
    queryVec = await embedText(provider, model, trimmed);
  } catch {
    return '';
  }

  const chunks = await KnowledgeChunk.find({ orgId: oid, 'embedding.0': { $exists: true } })
    .select('text embedding documentId chunkIndex')
    .limit(800)
    .lean();

  const docIds = [...new Set(chunks.map((c) => String(c.documentId)))];
  const docs = await KnowledgeDocument.find({ _id: { $in: docIds }, orgId: oid })
    .select('originalName')
    .lean();
  const docTitleById = new Map(docs.map((d) => [String(d._id), d.originalName]));

  const chunking = normalizeChunkingConfig(
    (await models.KnowledgeBaseConfig.findOne({ orgId: oid }).lean()) || {}
  );

  function rankChunks(vec) {
    return chunks
      .map((c) => ({
        text: c.text,
        score: cosineSimilarity(vec, c.embedding),
        documentId: String(c.documentId),
        chunkIndex: c.chunkIndex,
        docTitle: docTitleById.get(String(c.documentId)) || 'Document',
      }))
      .sort((a, b) => b.score - a.score);
  }

  let ranked = rankChunks(queryVec);
  let scored = ranked.slice(0, TOP_K);

  if (
    chunking.multiHopSearch &&
    scored.length &&
    scored[0].score < LOW_CONFIDENCE &&
    scored[0].score >= MIN_RELEVANCE
  ) {
    const broadQuery = `${trimmed}\n\nRelated context, definitions, and supporting details.`;
    try {
      const broadVec = await embedText(provider, model, broadQuery);
      const second = rankChunks(broadVec).slice(0, TOP_K * 2);
      const seen = new Set();
      scored = [];
      for (const item of [...ranked.slice(0, TOP_K), ...second]) {
        const key = `${item.documentId}:${item.chunkIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scored.push(item);
        if (scored.length >= TOP_K) break;
      }
    } catch {
      /* keep first-pass results */
    }
  }

  if (!scored.length || scored[0].score < MIN_RELEVANCE) return '';

  const lines = scored.map(
    (s, i) =>
      `[${i + 1}] source: ${s.docTitle} (chunk ${s.chunkIndex}, relevance ${s.score.toFixed(2)})\n${s.text}`
  );
  return lines.join('\n\n');
}
