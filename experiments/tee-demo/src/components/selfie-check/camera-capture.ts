import { abortable } from '@/lib/staging-registration'

// Keep the preview live until cancellation, tab hiding, or camera disconnection.
export async function startCamera(video: HTMLVideoElement, signal: AbortSignal, onReady: () => void): Promise<void> {
	if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
		throw new Error('Camera access requires HTTPS or localhost and a supported browser.')
	const interrupted = new AbortController()
	const lifetime = AbortSignal.any([signal, interrupted.signal])
	const deadline = AbortSignal.any([lifetime, AbortSignal.timeout(30_000)])
	let stream: MediaStream | undefined
	const stopTracks = (media: MediaStream) => media.getTracks().forEach(track => track.stop())
	const hidden = () => {
		if (document.hidden) interrupted.abort(new Error('Camera stopped when you left this tab. Try again.'))
	}
	const ended = () => interrupted.abort(new Error('The camera disconnected. Reconnect it and try again.'))
	document.addEventListener('visibilitychange', hidden)
	window.addEventListener('pagehide', ended)
	try {
		hidden()
		deadline.throwIfAborted()
		const media = navigator.mediaDevices
			.getUserMedia({
				audio: false,
				video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
			})
			.then(result => {
				// Permission can resolve after cancellation or timeout. Never retain that stream.
				if (deadline.aborted) stopTracks(result)
				return result
			})
		stream = await abortable(media, deadline)
		deadline.throwIfAborted()
		for (const track of stream.getVideoTracks()) track.addEventListener('ended', ended)
		video.srcObject = stream
		await abortable(video.play(), deadline)
		onReady()
		await new Promise<void>((_, reject) => {
			const abort = () => reject(lifetime.reason)
			if (lifetime.aborted) abort()
			else lifetime.addEventListener('abort', abort, { once: true })
		})
	} catch (cause) {
		if (signal.aborted) throw signal.reason
		if (interrupted.signal.aborted) throw interrupted.signal.reason
		if (deadline.aborted) throw new Error('Camera capture timed out. Allow camera access and try again.')
		if (cause instanceof DOMException && cause.name === 'NotAllowedError')
			throw new Error('Camera access was denied. Allow it in your browser settings, then try again.')
		if (cause instanceof DOMException && cause.name === 'NotFoundError')
			throw new Error('No camera was found. Connect a camera and try again.')
		if (cause instanceof DOMException && cause.name === 'NotReadableError')
			throw new Error('The camera is unavailable. Close other apps using it and try again.')
		throw cause
	} finally {
		if (stream) {
			for (const track of stream.getVideoTracks()) track.removeEventListener('ended', ended)
			stopTracks(stream)
		}
		video.pause()
		video.srcObject = null
		document.removeEventListener('visibilitychange', hidden)
		window.removeEventListener('pagehide', ended)
	}
}
