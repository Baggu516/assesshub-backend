import { Router } from 'express';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireOrgAdmin } from '../../middleware/admin.middleware.js';
import { requireAiPlan } from '../../middleware/plan.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { kbConfigPatchSchema } from './kb.schemas.js';
import { kbUpload } from './kb.upload.js';
import {
  getKbMetaHandler,
  getKbConfigHandler,
  patchKbConfigHandler,
  listKbDocumentsHandler,
  postKbDocumentHandler,
  deleteKbDocumentHandler,
  postKbReprocessHandler,
} from './kb.controller.js';

const r = Router();

r.use(tenantMiddleware, requireAuth, requireAiPlan);

/** Metadata for embedding/chunking options (any authenticated user can read). */
r.get('/meta', getKbMetaHandler);

/** Admin: org knowledge-base configuration and documents. */
r.use(requireOrgAdmin);

r.get('/config', getKbConfigHandler);
r.patch('/config', validateBody(kbConfigPatchSchema), patchKbConfigHandler);
r.get('/documents', listKbDocumentsHandler);
r.post('/documents', (req, res, next) => {
  kbUpload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'Upload failed' });
    }
    return next();
  });
}, postKbDocumentHandler);
r.delete('/documents/:id', deleteKbDocumentHandler);
r.post('/documents/:id/reprocess', postKbReprocessHandler);

export default r;
