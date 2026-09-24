import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subdomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]{2,63}$/, 'Invalid subdomain'],
    },
    /** MongoDB database for this tenant. New tenants use the subdomain with no prefix. */
    dbName: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 64,
      unique: true,
      sparse: true,
    },
    isActive: { type: Boolean, default: true },
    /** Public HTTPS logo URL (Supabase Storage). Shown on the login page. */
    logoUrl: { type: String, trim: true },
    /** Internal S3 ref `s3://bucket/key` for logo cleanup/replacement. */
    logoStoragePath: { type: String, trim: true },
    /** Short line shown under the school name on login. */
    tagline: { type: String, trim: true, maxlength: 160 },
    /**
     * Legacy summary of AI dashboard entitlement.
     * Prefer `features`; kept in sync when features are saved.
     * assessments_only — no dashboard AI / knowledge base
     * ai_dashboard — dashboard AI chat + knowledge base
     */
    plan: {
      type: String,
      enum: ['assessments_only', 'ai_dashboard'],
      default: 'assessments_only',
    },
    /**
     * Subscription flags. Each section is hidden until enabled.
     * Missing `onlineExams` on older documents is treated as on (legacy exams).
     */
    features: {
      aiDashboard: { type: Boolean, default: false },
      aiAssessmentCreate: { type: Boolean, default: false },
      worksheets: { type: Boolean, default: false },
      assessments: { type: Boolean, default: false },
      onlineExams: { type: Boolean, default: false },
    },
    settings: {
      timezone: { type: String, default: 'UTC' },
      /** Optional nav label overrides. Keys: dashboard, subordinates, users, usersMember, profile, organization, settingsNav, assessments, myAssessments, groupStudents, classes, knowledgeBase */
      sidebarLabels: {
        dashboard: { type: String, trim: true, maxlength: 48 },
        subordinates: { type: String, trim: true, maxlength: 48 },
        users: { type: String, trim: true, maxlength: 48 },
        usersMember: { type: String, trim: true, maxlength: 48 },
        profile: { type: String, trim: true, maxlength: 48 },
        organization: { type: String, trim: true, maxlength: 48 },
        settingsNav: { type: String, trim: true, maxlength: 48 },
        assessments: { type: String, trim: true, maxlength: 48 },
        myAssessments: { type: String, trim: true, maxlength: 48 },
        groupStudents: { type: String, trim: true, maxlength: 48 },
        classes: { type: String, trim: true, maxlength: 48 },
        knowledgeBase: { type: String, trim: true, maxlength: 48 },
      },
    },
  },
  { timestamps: true }
);

export const Organization = mongoose.model('Organization', organizationSchema);
