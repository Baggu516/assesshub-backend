import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getOrCreateKbConfig,
  updateKbConfig,
  getKbMeta,
  listKbDocuments,
  listKbDocumentChunks,
  listKbQuestions,
  ingestKbDocument,
  deleteKbDocument,
  reprocessKbDocument,
} from './kb.service.js';

export const getKbMetaHandler = asyncHandler(async (_req, res) => {
  res.json(getKbMeta());
});

export const getKbConfigHandler = asyncHandler(async (req, res) => {
  const config = await getOrCreateKbConfig(req.tenantModels, req.tenant.orgId);
  res.json({ config, meta: getKbMeta() });
});

export const patchKbConfigHandler = asyncHandler(async (req, res) => {
  const config = await updateKbConfig(req.tenantModels, req.tenant.orgId, req.body);
  res.json({ config });
});

export const listKbDocumentsHandler = asyncHandler(async (req, res) => {
  const documents = await listKbDocuments(req.tenantModels, req.tenant.orgId);
  res.json({ documents });
});

export const listKbDocumentChunksHandler = asyncHandler(async (req, res) => {
  const chunks = await listKbDocumentChunks(req.tenantModels, req.tenant.orgId, req.params.id);
  res.json({ chunks });
});

export const listKbQuestionsHandler = asyncHandler(async (req, res) => {
  const questions = await listKbQuestions(req.tenantModels, req.tenant.orgId);
  res.json({ questions });
});

export const postKbDocumentHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const document = await ingestKbDocument(
    req.tenantModels,
    req.tenant.orgId,
    req.user._id,
    req.file
  );
  res.status(201).json({ document });
});

export const deleteKbDocumentHandler = asyncHandler(async (req, res) => {
  await deleteKbDocument(req.tenantModels, req.tenant.orgId, req.params.id);
  res.status(204).send();
});

export const postKbReprocessHandler = asyncHandler(async (req, res) => {
  const document = await reprocessKbDocument(req.tenantModels, req.tenant.orgId, req.params.id);
  res.json({ document });
});
