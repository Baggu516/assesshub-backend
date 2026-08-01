import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  listClassMasters,
  createClassMaster,
  updateClassMaster,
  deleteClassMaster,
} from './class-master.service.js';

export const getClassMasters = asyncHandler(async (req, res) => {
  const result = await listClassMasters(req.tenantModels, req.user, req.tenant.orgId);
  res.json(result);
});

export const postClassMaster = asyncHandler(async (req, res) => {
  const classMaster = await createClassMaster(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.body,
    req.ip
  );
  res.status(201).json({ classMaster });
});

export const patchClassMaster = asyncHandler(async (req, res) => {
  const classMaster = await updateClassMaster(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.body,
    req.ip
  );
  res.json({ classMaster });
});

export const removeClassMaster = asyncHandler(async (req, res) => {
  const result = await deleteClassMaster(
    req.tenantModels,
    req.user,
    req.tenant.orgId,
    req.params.id,
    req.ip
  );
  res.json(result);
});
