import mongoose from 'mongoose';
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
import { classSchema } from '../models/Class.js';
import { classMemberSchema } from '../models/ClassMember.js';
import { academicYearSchema } from '../models/AcademicYear.js';
import { classMasterSchema } from '../models/ClassMaster.js';
import { enrollmentSchema } from '../models/Enrollment.js';
import { learningResourceSchema } from '../models/LearningResource.js';
import { Organization } from '../models/Organization.js';

const cacheByDbName = new Map();
const dbNameBySubdomain = new Map();

/**
 * Database name for a newly created tenant: the subdomain itself, with no prefix.
 */
export function databaseNameFromSubdomain(subdomain) {
  const safe = String(subdomain || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!safe) throw new Error('Invalid subdomain for tenant database');
  return safe;
}

/** Name used before `Organization.dbName` existed (`TENANT_DB_PREFIX` + subdomain). */
function legacyPrefixedDatabaseName(subdomain) {
  const safe = databaseNameFromSubdomain(subdomain);
  const prefix = String(process.env.TENANT_DB_PREFIX || '');
  return prefix ? `${prefix}${safe}` : safe;
}

export function rememberTenantDatabaseName(subdomain, dbName) {
  dbNameBySubdomain.set(String(subdomain || '').toLowerCase(), dbName);
}

export function forgetTenantDatabaseName(subdomain) {
  dbNameBySubdomain.delete(String(subdomain || '').toLowerCase());
}

/**
 * Stored name when present. Older tenants are pinned to their prefixed database
 * so existing data stays on the same database.
 */
export async function resolveTenantDatabaseName(subdomain) {
  const key = String(subdomain || '').toLowerCase();
  const cached = dbNameBySubdomain.get(key);
  if (cached) return cached;

  const org = await Organization.findOne({ subdomain: key }).select('dbName').lean();
  if (!org) return legacyPrefixedDatabaseName(key);

  let dbName = org.dbName ? String(org.dbName).toLowerCase() : '';
  if (!dbName) {
    dbName = legacyPrefixedDatabaseName(key);
    await Organization.updateOne(
      {
        _id: org._id,
        $or: [{ dbName: { $exists: false } }, { dbName: null }, { dbName: '' }],
      },
      { $set: { dbName } }
    );
  }

  dbNameBySubdomain.set(key, dbName);
  return dbName;
}

/** Persist a database name on tenants created before the field existed. */
export async function backfillMissingDatabaseNames() {
  const missing = await Organization.find({
    $or: [{ dbName: { $exists: false } }, { dbName: null }, { dbName: '' }],
  })
    .select('subdomain')
    .lean();

  for (const org of missing) {
    let dbName;
    try {
      dbName = legacyPrefixedDatabaseName(org.subdomain);
    } catch {
      continue;
    }
    const taken = await Organization.findOne({ dbName, _id: { $ne: org._id } }).select('_id').lean();
    if (taken) continue;
    await Organization.updateOne(
      {
        _id: org._id,
        $or: [{ dbName: { $exists: false } }, { dbName: null }, { dbName: '' }],
      },
      { $set: { dbName } }
    );
    rememberTenantDatabaseName(org.subdomain, dbName);
  }
}

/** Mongoose models bound to this tenant's database (`useDb`). */
export async function getTenantModels(subdomain) {
  const dbName = await resolveTenantDatabaseName(subdomain);
  let cached = cacheByDbName.get(dbName);
  if (cached) return cached;

  const conn = mongoose.connection.useDb(dbName, { useCache: true });

  const models = {
    User: (() => {
      const m = conn.models.User || conn.model('User', userSchema);
      // Restore a unique email per school if a non-unique index was created earlier.
      m.collection
        .dropIndex('orgId_1_email_1')
        .catch(() => {})
        .then(() =>
          m.collection.createIndex(
            { orgId: 1, email: 1 },
            { unique: true, name: 'orgId_1_email_1' }
          )
        )
        .catch(() => {});
      return m;
    })(),
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
    AssessmentAssignment: (() => {
      const m =
        conn.models.AssessmentAssignment ||
        conn.model('AssessmentAssignment', assessmentAssignmentSchema);
      // Old unique key blocked re-assigning the same quiz in a new academic year
      m.collection
        .dropIndex('orgId_1_assessmentId_1_studentId_1')
        .catch(() => {});
      return m;
    })(),
    StudentGroup: conn.models.StudentGroup || conn.model('StudentGroup', studentGroupSchema),
    Class: conn.models.Class || conn.model('Class', classSchema),
    ClassMember: conn.models.ClassMember || conn.model('ClassMember', classMemberSchema),
    AcademicYear: conn.models.AcademicYear || conn.model('AcademicYear', academicYearSchema),
    ClassMaster: conn.models.ClassMaster || conn.model('ClassMaster', classMasterSchema),
    Enrollment: conn.models.Enrollment || conn.model('Enrollment', enrollmentSchema),
    LearningResource:
      conn.models.LearningResource || conn.model('LearningResource', learningResourceSchema),
  };

  cacheByDbName.set(dbName, models);
  return models;
}
