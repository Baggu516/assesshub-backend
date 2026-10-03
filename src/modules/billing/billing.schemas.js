import { z } from 'zod';

export const checkoutSchema = z.object({
  planId: z.enum(['monthly', 'quarterly', 'yearly']),
});

export const verifyPaymentSchema = z.object({
  paymentId: z.string().trim().min(1),
  razorpay_order_id: z.string().trim().min(1),
  razorpay_payment_id: z.string().trim().min(1),
  razorpay_signature: z.string().trim().min(1),
});

export const devActivateSchema = z.object({
  paymentId: z.string().trim().min(1),
});
