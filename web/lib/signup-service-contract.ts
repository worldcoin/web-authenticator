import { z } from 'zod'
import { isCanonicalSubject, isCanonicalUuid } from './enrollment-contract'

const receiptIdentity = {
	sub: z.string().refine(isCanonicalSubject),
	captureId: z.string().refine(isCanonicalUuid),
}

// Retained locally from the submitted capture, not returned by PUT.
export const EnrollmentReceiptSchema = z.object(receiptIdentity)
export const SubmissionAcceptanceSchema = z.object({})

export const EnrollmentStatusSchema = z.object({
	status: z.enum([
		'ENROLLMENT_IN_PROGRESS',
		'ENROLLMENT_UNIQUE_SUCCESSFUL',
		'ENROLLMENT_NOT_UNIQUE',
		'ENROLLMENT_FAILED',
	]),
	capture_id: z.string(),
	credential: z.string().nullish(),
})

// Same public response as Face v1 and Oxide's FaceIdentityStatusResponse.
export const IdentityStatusSchema = z.object({
	status: z.enum(['NEW', 'VERIFIED', 'UNVERIFIED']),
	last_successful_capture_id: z.string().nullish(),
	enrollment_status: EnrollmentStatusSchema.nullish(),
	deletion_status: z.object({
		identity_status: z.string(),
		deletion_request_id: z.string().nullish(),
		idcomm_deletion_timestamp: z.string().nullish(),
		shares_deletion_timestamp: z.string().nullish(),
		shares_scheduled_deletion_timestamp: z.string().nullish(),
	}).nullish(),
})

export const SignupServiceErrorSchema = z.object({
	error: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
	retryable: z.boolean().optional(),
})

export type IdentityStatusResponse = z.infer<typeof IdentityStatusSchema>
