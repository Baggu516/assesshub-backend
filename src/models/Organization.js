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
    isActive: { type: Boolean, default: true },
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
