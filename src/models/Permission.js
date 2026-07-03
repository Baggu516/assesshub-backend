import mongoose from 'mongoose';

/** Permission catalog rows per tenant DB (keys used in User.permissions). */
export const permissionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String },
  },
  { timestamps: true }
);
