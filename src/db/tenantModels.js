import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { userSchema } from '../models/User.js';
import { roleSchema } from '../models/Role.js';
import { permissionSchema } from '../models/Permission.js';
import { notificationSchema } from '../models/Notification.js';
import { activityLogSchema } from '../models/ActivityLog.js';
import { refreshTokenSchema } from '../models/RefreshToken.js';
import { aiChatSessionSchema } from '../models/AiChatSession.js';
import { knowledgeBaseConfigSchema } from '../models/KnowledgeBaseConfig.js';
import { knowledgeDocumentSchema } from '../models/KnowledgeDocument.js';
import { knowledgeChunkSchema } from '../models/KnowledgeChunk.js';
import { assessmentSchema } from '../models/Assessment.js';
import { assessmentAssignmentSchema } from '../models/AssessmentAssignment.js';
import { studentGroupSchema } from '../models/StudentGroup.js';

const cacheByDbName = new Map();

/**
 * Stable MongoDB database name for a tenant (same cluster as registry).
 */
export function tenantDatabaseName(subdomain) {
  const safe = String(subdomain || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!safe) throw new Error('Invalid subdomain for tenant database');
  return `${env.TENANT_DB_PREFIX}${safe}`;
}

/** Mongoose models bound to this tenant's database (`useDb`). */
export function getTenantModels(subdomain) {
  const dbName = tenantDatabaseName(subdomain);
  let cached = cacheByDbName.get(dbName);
  if (cached) return cached;

  const conn = mongoose.connection.useDb(dbName, { useCache: true });

  const models = {
    User: conn.models.User || conn.model('User', userSchema),
    Role: conn.models.Role || conn.model('Role', roleSchema),
    Permission: conn.models.Permission || conn.model('Permission', permissionSchema),
    Notification: conn.models.Notification || conn.model('Notification', notificationSchema),
    ActivityLog: conn.models.ActivityLog || conn.model('ActivityLog', activityLogSchema),
    RefreshToken: conn.models.RefreshToken || conn.model('RefreshToken', refreshTokenSchema),
    AiChatSession:
      conn.models.AiChatSession || conn.model('AiChatSession', aiChatSessionSchema),
    KnowledgeBaseConfig:
      conn.models.KnowledgeBaseConfig ||
      conn.model('KnowledgeBaseConfig', knowledgeBaseConfigSchema),
    KnowledgeDocument:
      conn.models.KnowledgeDocument || conn.model('KnowledgeDocument', knowledgeDocumentSchema),
    KnowledgeChunk:
      conn.models.KnowledgeChunk || conn.model('KnowledgeChunk', knowledgeChunkSchema),
    Assessment: conn.models.Assessment || conn.model('Assessment', assessmentSchema),
    AssessmentAssignment:
      conn.models.AssessmentAssignment ||
      conn.model('AssessmentAssignment', assessmentAssignmentSchema),
    StudentGroup: conn.models.StudentGroup || conn.model('StudentGroup', studentGroupSchema),
  };

  cacheByDbName.set(dbName, models);
  return models;
}
