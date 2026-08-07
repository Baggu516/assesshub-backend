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
import { EMBEDDING_MODEL_OPTIONS, DEFAULT_EMBEDDING_MODEL } from './kb.constants.js';
import {
  DEFAULT_CHUNKING,
  normalizeChunkingConfig,
  resolveChunkingParams,
  serializeChunkingSettings,
  toPersistedChunkingFields,
} from './kb.config.util.js';
import { projectUploadsPath } from '../../utils/writableDir.js';
import { s3Configured, uploadFileToS3, deleteS3Object, isS3StoragePath } from '../../utils/s3.js';
import {
  enrichmentAvailable,
  generateDocumentSummary,
  generateSyntheticQuestions,
} from './kb.enrich.js';
import { ollamaConfigured } from '../ai/ollama.util.js';

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
      ...toPersistedChunkingFields(DEFAULT_CHUNKING),
      embeddingProvider: 'ollama',
      embeddingModel: DEFAULT_EMBEDDING_MODEL.ollama,
    });
  }
  return serializeConfig(doc);
}

export async function updateKbConfig(models, orgId, patch) {
  const { KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  const existing = await KnowledgeBaseConfig.findOne({ orgId: oid }).lean();

  // Keep token aliases in sync so normalize doesn't prefer stale legacy fields.
  const incoming = { ...patch };
  if (patch.chunkSize != null) {
    incoming.chunkSize = patch.chunkSize;
    incoming.targetTokens = patch.chunkSize;
  } else if (patch.targetTokens != null) {
    incoming.chunkSize = patch.targetTokens;
    incoming.targetTokens = patch.targetTokens;
  }
  if (patch.chunkOverlap != null) {
    incoming.chunkOverlap = patch.chunkOverlap;
    incoming.overlapTokens = patch.chunkOverlap;
  } else if (patch.overlapTokens != null) {
    incoming.chunkOverlap = patch.overlapTokens;
    incoming.overlapTokens = patch.overlapTokens;
  }
  if (patch.chunkingStrategy === 'original') {
    incoming.sourceOnlyMode = true;
    incoming.semanticSplitting = false;
    incoming.autoSummary = false;
    incoming.syntheticQuestions = false;
  } else if (patch.chunkingStrategy === 'semantic') {
    incoming.sourceOnlyMode = false;
    incoming.semanticSplitting = true;
  } else if (patch.sourceOnlyMode === true) {
    incoming.chunkingStrategy = 'original';
    incoming.semanticSplitting = false;
    incoming.autoSummary = false;
    incoming.syntheticQuestions = false;
  } else if (patch.semanticSplitting === true && patch.sourceOnlyMode !== true) {
    incoming.chunkingStrategy = 'semantic';
    incoming.sourceOnlyMode = false;
  } else if (patch.semanticSplitting === false) {
    incoming.chunkingStrategy = 'original';
    incoming.autoSummary = false;
    incoming.syntheticQuestions = false;
  }

  const merged = normalizeChunkingConfig({ ...existing, ...incoming });
  // Original / source-only never runs AI ingestion enhancements.
  if (merged.chunkingStrategy === 'original') {
    merged.autoSummary = false;
    merged.syntheticQuestions = false;
  }
  const set = {
    ...incoming,
    ...toPersistedChunkingFields(merged),
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
    embeddingProviders: ['ollama'],
    embeddingModels: {
      ollama: EMBEDDING_MODEL_OPTIONS.ollama,
    },
    providersAvailable: {
      ollama: embeddingProviderConfigured('ollama'),
    },
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

export async function listKbDocumentChunks(models, orgId, documentId) {
  const { KnowledgeDocument, KnowledgeChunk } = models;
  const oid = orgOid(orgId);
  const doc = await KnowledgeDocument.findOne({ _id: documentId, orgId: oid }).lean();
  if (!doc) throw httpError(404, 'Document not found');

  const rows = await KnowledgeChunk.find({ orgId: oid, documentId: doc._id })
    .select('chunkIndex chunkKind text createdAt')
    .sort({ chunkIndex: 1 })
    .lean();

  return rows.map((c) => ({
    id: String(c._id),
    chunkIndex: c.chunkIndex,
    chunkKind: c.chunkKind || 'content',
    text: c.text,
    createdAt: c.createdAt,
  }));
}

/** Org-wide AI questions with whether RAG snippets were used for that turn. */
export async function listKbQuestions(models, orgId) {
  const { AiChatSession, User } = models;
  const oid = orgOid(orgId);

  const sessions = await AiChatSession.find({ orgId: oid })
    .select('userId messages updatedAt')
    .sort({ updatedAt: -1 })
    .limit(150)
    .lean();

  const userIds = [...new Set(sessions.map((s) => String(s.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('firstName lastName email')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const questions = [];
  for (const session of sessions) {
    const user = userById.get(String(session.userId));
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      'Unknown';
    const messages = session.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      const assistant = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : null;
      const sources = Array.isArray(m.knowledgeSources)
        ? m.knowledgeSources.map((s) => ({
            documentId: String(s.documentId),
            title: s.title || '',
          }))
        : [];
      questions.push({
        id: `${String(session._id)}-${i}`,
        chatId: String(session._id),
        messageIndex: i,
        name,
        email: user?.email || '',
        question: m.content,
        rag: Boolean(m.knowledgeBaseUsed),
        sources,
        feedback: assistant?.feedback === 'up' || assistant?.feedback === 'down' ? assistant.feedback : null,
        feedbackAt: assistant?.feedbackAt || null,
        askedAt: m.askedAt || session.updatedAt,
      });
    }
  }

  questions.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime());
  return questions.slice(0, 200);
}

export async function processDocument(models, orgId, documentId) {
  const { KnowledgeDocument, KnowledgeChunk, KnowledgeBaseConfig } = models;
  const oid = orgOid(orgId);
  const doc = await KnowledgeDocument.findOne({ _id: documentId, orgId: oid });
  if (!doc) return;

  const savedConfig = (await KnowledgeBaseConfig.findOne({ orgId: oid }).lean()) || {
    ...DEFAULT_CHUNKING,
  };
  const embeddingConfig = await getEmbeddingConfigForOrg(models, orgId);
  const chunking = normalizeChunkingConfig(savedConfig);

  if (!embeddingConfig) {
    doc.status = 'failed';
    doc.errorMessage =
      'Ollama is not configured. Set OLLAMA_ENABLED=true (or OLLAMA_BASE_URL) and pull nomic-embed-text.';
    await doc.save();
    return;
  }

  // Heal stale configs (e.g. gemini/huggingface saved before Ollama-only).
  if (
    savedConfig.embeddingProvider !== embeddingConfig.embeddingProvider ||
    savedConfig.embeddingModel !== embeddingConfig.embeddingModel
  ) {
    await KnowledgeBaseConfig.findOneAndUpdate(
      { orgId: oid },
      {
        $set: {
          embeddingProvider: embeddingConfig.embeddingProvider,
          embeddingModel: embeddingConfig.embeddingModel,
        },
      },
      { upsert: true }
    );
  }

  try {
    doc.status = 'processing';
    doc.errorMessage = '';
    await doc.save();

    console.log(`[kb] extract start doc=${doc._id}`);
    const text = await extractTextFromFile(doc.storagePath, doc.fileType);
    if (!text || text.length < 10) {
      throw new Error('No extractable text found in file');
    }
    console.log(`[kb] extract done chars=${text.length}`);

    const { strategy, chunkSize, chunkOverlap } = resolveChunkingParams(savedConfig);
    const contentChunks = chunkText(text, strategy, chunkSize, chunkOverlap);

    if (!contentChunks.length) {
      throw new Error('Chunking produced no segments');
    }
    console.log(`[kb] chunked segments=${contentChunks.length} strategy=${strategy}`);

    await KnowledgeChunk.deleteMany({ orgId: oid, documentId: doc._id });

    // Embed content first so docs become searchable even if enrichment is slow/unavailable.
    const segments = contentChunks.map((t) => ({ text: t, chunkKind: 'content' }));

    const provider = embeddingConfig.embeddingProvider;
    const model = resolveEmbeddingModel(provider, embeddingConfig.embeddingModel);
    console.log(`[kb] embed start provider=${provider} model=${model}`);

    const batchSize = 8;
    const chunkDocs = [];

    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const texts = batch.map((s) => s.text);
      const vectors = await embedTexts(provider, model, texts);
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
      console.log(`[kb] embed progress ${Math.min(i + batch.length, segments.length)}/${segments.length}`);
    }

    // Optional enrichment after content embeddings (soft-fail; never blocks forever).
    const canEnrich =
      enrichmentAvailable() && chunking.chunkingStrategy !== 'original';
    const ENRICH_MS = 45_000;
    if (canEnrich && chunking.autoSummary) {
      try {
        console.log('[kb] summary start');
        const summary = await Promise.race([
          generateDocumentSummary(text, doc.originalName),
          new Promise((_, reject) => setTimeout(() => reject(new Error('summary timeout')), ENRICH_MS)),
        ]);
        if (summary) {
          const vector = (await embedTexts(provider, model, [summary]))[0];
          chunkDocs.unshift({
            orgId: oid,
            documentId: doc._id,
            chunkIndex: -1,
            chunkKind: 'summary',
            text: `[Document summary] ${summary}`,
            embedding: vector,
          });
        }
      } catch (e) {
        console.warn('[kb] summary skipped:', e.message || e);
      }
    }
    if (canEnrich && chunking.syntheticQuestions) {
      try {
        console.log('[kb] synthetic questions start');
        const questions = await Promise.race([
          generateSyntheticQuestions(text, doc.originalName),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('synthetic questions timeout')), ENRICH_MS)
          ),
        ]);
        for (const q of questions) {
          const vector = (await embedTexts(provider, model, [q]))[0];
          chunkDocs.push({
            orgId: oid,
            documentId: doc._id,
            chunkIndex: chunkDocs.length,
            chunkKind: 'synthetic_question',
            text: q,
            embedding: vector,
          });
        }
      } catch (e) {
        console.warn('[kb] synthetic questions skipped:', e.message || e);
      }
    }

    // Normalize chunkIndex to 0..n-1 after optional prepends.
    chunkDocs.forEach((c, idx) => {
      c.chunkIndex = idx;
    });

    await KnowledgeChunk.insertMany(chunkDocs);

    doc.status = 'ready';
    doc.extractedCharCount = text.length;
    doc.chunkCount = chunkDocs.length;
    doc.errorMessage = '';
    await doc.save();
    console.log(`[kb] ready doc=${doc._id} chunks=${chunkDocs.length}`);
  } catch (err) {
    console.error(`[kb] failed doc=${doc._id}:`, err.message || err);
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

  const docId = new mongoose.Types.ObjectId();
  const ext = path.extname(file.originalname) || `.${fileType}`;
  const objectKey = `kb/${String(orgId)}/${String(docId)}${ext}`;

  let storagePath;
  try {
    if (s3Configured()) {
      storagePath = await uploadFileToS3(file.path, objectKey, file.mimetype || undefined);
      await fs.unlink(file.path).catch(() => {});
    } else {
      const uploadDir = await ensureKbUploadDir(orgId);
      storagePath = path.join(uploadDir, `${String(docId)}${ext}`);
      await fs.rename(file.path, storagePath);
    }
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
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
      storagePath,
      fileSize: file.size,
      status: 'pending',
    });
  } catch (err) {
    if (isS3StoragePath(storagePath)) {
      await deleteS3Object(storagePath).catch(() => {});
    } else {
      await fs.unlink(storagePath).catch(() => {});
    }
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
    if (isS3StoragePath(doc.storagePath)) {
      await deleteS3Object(doc.storagePath);
    } else {
      await fs.unlink(doc.storagePath);
    }
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
  if (!ollamaConfigured()) return null;
  const model =
    saved?.embeddingProvider === 'ollama' && saved?.embeddingModel
      ? saved.embeddingModel
      : DEFAULT_EMBEDDING_MODEL.ollama;
  return {
    embeddingProvider: 'ollama',
    embeddingModel: model,
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
 * @returns {{ context: string, sources: { documentId: string, title: string, score: number }[] }}
 */
export async function retrieveKnowledgeContext(models, orgId, query) {
  const { KnowledgeChunk, KnowledgeDocument } = models;
  const trimmed = (query || '').trim();
  if (!trimmed) return { context: '', sources: [] };

  const oid = orgOid(orgId);
  const config = await getEmbeddingConfigForOrg(models, orgId);
  if (!config) return { context: '', sources: [] };

  const chunkCount = await KnowledgeChunk.countDocuments({
    orgId: oid,
    'embedding.0': { $exists: true },
  });
  if (!chunkCount) return { context: '', sources: [] };

  const provider = config.embeddingProvider;
  const model = resolveEmbeddingModel(provider, config.embeddingModel);
  let queryVec;
  try {
    queryVec = await embedText(provider, model, trimmed);
  } catch {
    return { context: '', sources: [] };
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

  if (!scored.length || scored[0].score < MIN_RELEVANCE) {
    return { context: '', sources: [] };
  }

  const lines = scored.map(
    (s, i) =>
      `[${i + 1}] source: ${s.docTitle} (chunk ${s.chunkIndex}, relevance ${s.score.toFixed(2)})\n${s.text}`
  );

  const sourceMap = new Map();
  for (const s of scored) {
    if (!sourceMap.has(s.documentId)) {
      sourceMap.set(s.documentId, { documentId: s.documentId, title: s.docTitle, score: s.score });
    }
  }

  return {
    context: lines.join('\n\n'),
    sources: [...sourceMap.values()],
  };
}
