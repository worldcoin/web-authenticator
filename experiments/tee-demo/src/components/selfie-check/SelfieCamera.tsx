import { startCamera } from './camera-capture'
import { useEffect, useRef, useState } from 'react'
import { startFaceDetector } from './face-detector'
import { faceGuidance, previewPoint, type FaceDetection } from './rgbnet'

export default function SelfieCamera({
	onEvent,
	detectFaces = false,
	diagnostics = false,
	onCapture,
	captureDisabled = false,
}: {
	onEvent?: (message: string) => void
	detectFaces?: boolean
	diagnostics?: boolean
	onCapture?: (image: Uint8Array) => Promise<void>
	captureDisabled?: boolean
}) {
	const video = useRef<HTMLVideoElement>(null)
	const mounted = useRef(false)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const [attempt, setAttempt] = useState(0)
	const [ready, setReady] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [detectionError, setDetectionError] = useState<string | null>(null)
	const [detectionAttempt, setDetectionAttempt] = useState(0)
	const [detection, setDetection] = useState<{ faces: FaceDetection[]; width: number; height: number } | null>(null)

	useEffect(() => {
		if (!detectFaces || !ready || !video.current) return
		const controller = new AbortController()
		setDetection(null)
		setDetectionError(null)
		try {
			startFaceDetector(
				video.current,
				controller.signal,
				diagnostics,
				(faces, width, height) => setDetection({ faces, width, height }),
				message => onEvent?.(message),
				message => {
					setDetection(null)
					setDetectionError(message)
				}
			)
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Face detection is unavailable'
			setDetectionError(message)
			onEvent?.(`RGBNet error: ${message}`)
		}
		return () => controller.abort()
	}, [detectFaces, diagnostics, ready, detectionAttempt, onEvent])

	useEffect(() => {
		const preview = video.current
		if (!preview) return
		const controller = new AbortController()
		onEvent?.('startCamera(): requesting camera access.')
		void startCamera(preview, controller.signal, () => {
			setReady(true)
			onEvent?.('startCamera(): live preview ready. No frames uploaded.')
		}).catch(cause => {
			if (!controller.signal.aborted) {
				setReady(false)
				setError(cause instanceof Error ? cause.message : 'Camera failed. Try again.')
				onEvent?.('startCamera(): interrupted or unavailable. See camera error; retry is available.')
			}
		})
		return () => controller.abort()
	}, [attempt, onEvent])

	const [capturing, setCapturing] = useState(false)
	async function capture() {
		if (!onCapture || capturing || captureDisabled || !video.current || !ready) return
		setCapturing(true)
		const canvas = document.createElement('canvas')
		let image: Uint8Array | undefined
		try {
			const preview = video.current
			const scale = Math.min(1, 1280 / Math.max(preview.videoWidth, preview.videoHeight))
			canvas.width = Math.round(preview.videoWidth * scale)
			canvas.height = Math.round(preview.videoHeight * scale)
			if (!canvas.width || !canvas.height) throw new Error('Camera frame is unavailable.')
			const context = canvas.getContext('2d')
			if (!context) throw new Error('Camera capture is unavailable.')
			context.drawImage(preview, 0, 0, canvas.width, canvas.height)
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					value => (value ? resolve(value) : reject(new Error('Could not encode camera frame.'))),
					'image/jpeg',
					0.92
				)
			)
			if (blob.size > 8 * 1024 * 1024) throw new Error('Camera frame is too large.')
			image = new Uint8Array(await blob.arrayBuffer())
			if (mounted.current) await onCapture(image)
		} catch {
			setError('Capture failed. Please retry the camera.')
		} finally {
			if (image?.byteLength) image.fill(0)
			canvas.width = canvas.height = 0
			setCapturing(false)
		}
	}

	return (
		<div className="mt-6">
			<div className="relative mx-auto aspect-square w-full max-w-72 overflow-hidden rounded-full border-4 border-border bg-black">
				<video
					ref={video}
					muted
					playsInline
					autoPlay
					aria-label="Live selfie camera"
					className="h-full w-full -scale-x-100 object-cover"
				/>
				{detectFaces && ready && !detectionError && detection && (
					<svg
						viewBox="0 0 1 1"
						aria-label="Detected face positions"
						className="pointer-events-none absolute inset-0 h-full w-full"
						fill="none"
					>
						{detection.faces.map((face, index) => {
							const [right, top] = previewPoint(
								face.box[0],
								face.box[1],
								detection.width,
								detection.height
							)
							const [left, bottom] = previewPoint(
								face.box[2],
								face.box[3],
								detection.width,
								detection.height
							)
							return (
								<g key={index} stroke="#00ff99" strokeWidth="0.006">
									<rect x={left} y={top} width={right - left} height={bottom - top} />
									{Array.from({ length: 5 }, (_, i) => {
										const [x, y] = previewPoint(
											face.landmarks[i * 2],
											face.landmarks[i * 2 + 1],
											detection.width,
											detection.height
										)
										return <circle key={i} cx={x} cy={y} r="0.008" />
									})}
								</g>
							)
						})}
					</svg>
				)}
			</div>
			<p role="status" className="mt-4 font-medium">
				{error
					? 'Camera interrupted'
					: !ready
						? 'Opening camera…'
						: !detectFaces
							? 'Place your face in the circle'
							: detectionError
								? 'Face detection unavailable'
								: detection
									? faceGuidance(detection.faces, detection.width, detection.height)
									: 'Loading face detector…'}
			</p>
			{onCapture && (
				<button
					className="sheet-primary mt-4 w-full"
					disabled={!ready || capturing || captureDisabled}
					onClick={() => void capture()}
				>
					{capturing ? 'Processing selfie…' : 'Capture and send to staging enclave'}
				</button>
			)}
			{detectFaces && detectionError && ready && (
				<>
					<p role="alert" className="mt-2 text-sm">
						{detectionError}
					</p>
					<button className="sheet-secondary mt-4" onClick={() => setDetectionAttempt(value => value + 1)}>
						Retry detection
					</button>
				</>
			)}
			{error && (
				<>
					<p role="alert" className="mt-2 text-sm">
						{error}
					</p>
					<button
						className="sheet-primary mt-4 w-full"
						onClick={() => {
							setError(null)
							setReady(false)
							setAttempt(value => value + 1)
						}}
					>
						Try camera again
					</button>
				</>
			)}
		</div>
	)
}
