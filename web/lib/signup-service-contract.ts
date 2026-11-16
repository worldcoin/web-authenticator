import { z } from 'zod'
import { isCanonicalSubject, isCanonicalUuid } from './enrollment-contract'

const captureIdentity = {
	sub: z.string().refine(isCanonicalSubject),
	capture_id: z.string().refine(isCanonicalUuid),
}

// Object schemas accept additive metadata; known fields retain their exact wire constraints.
export const SubmissionReceiptSchema = z.object(captureIdentity)

const status = z.object({
	...captureIdentity,
	unique: z.boolean(),
	error: z.string().refine(value => value.length <= 1024).optional(),
})

export const EnrollmentStatusSchema = z.union([
	status.extend({
		status: z.literal('Completed'),
		unique: z.literal(true),
		credential: z.string(),
	}),
	status.extend({
		status: z.literal('Completed'),
		unique: z.literal(false),
		credential: z.never().optional(),
	}),
	status.extend({
		status: z.enum(['Received', 'InProgress', 'PendingActivation', 'Failed', 'Error', 'Expired']),
		credential: z.never().optional(),
	}),
])

export const SignupServiceErrorSchema = z.object({
	error: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
	retryable: z.boolean(),
})

export type SubmissionReceiptResponse = z.infer<typeof SubmissionReceiptSchema>
export type EnrollmentStatusResponse = z.infer<typeof EnrollmentStatusSchema>
export type SignupServiceErrorResponse = z.infer<typeof SignupServiceErrorSchema>
