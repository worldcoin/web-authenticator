'use client'

import { useState } from 'react'
import QRCode from '@/components/QRCode'
import spainFlag from '@images/spain.png'
import marbleImg from '@images/marble.png'
import * as motion from 'motion/react-client'
import { AnimatePresence } from 'motion/react'
import UserDropdown from '@/components/UserDropdown'
import WorldMark from '@/components/icons/WorldMark'
import FailedIcon from '@/components/icons/FailedIcon'
import SpinnerIcon from '@/components/icons/SpinnerIcon'

export default function Home() {
	const [didFail, setFailed] = useState(false)
	const [isLoading, setLoading] = useState(false)

	return (
		<div className="flex flex-col min-h-screen py-6 px-4 md:px-10 bg-background text-primary">
			<header className="flex items-center justify-between max-w-[1800px] mx-auto w-full">
				<WorldMark className="h-6" />
				<UserDropdown marble={marbleImg} passport={{ country: 'Spain', flag: spainFlag }} onLogOut={() => {}} />
			</header>

			<main className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto">
				<div className="flex flex-col gap-4">
					<h1 className="font-tiempos text-[45px] leading-12">Welcome, Unique Human</h1>
					<p className="text-secondary font-light text-[17px]">
						World ID is a privacy-preserving digital passport that lets you prove you're a real, unique
						person—without revealing your identity.
					</p>
				</div>
				<div className="h-px w-full bg-border mt-8 mb-14" />
				<div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
					<div className="flex flex-col gap-3">
						<motion.p className="text-3xl leading-8">
							{didFail ? 'Connection failed' : 'Connect your World ID'}
						</motion.p>
						<motion.p className="text-secondary font-light text-[17px] leading-5">
							{didFail
								? 'Something went wrong. Please try scanning again.'
								: 'Scan the following QR code with your World ID app to connect and start using immediately.'}
						</motion.p>
						<AnimatePresence>
							{didFail && (
								<motion.button
									exit={{ opacity: 0, y: 10 }}
									whileHover={{ opacity: 0.8 }}
									animate={{ opacity: 1, y: 0 }}
									initial={{ opacity: 0, y: 10 }}
									onClick={() => setFailed(false)}
									className="mt-6 rounded-full bg-primary text-white py-3.5 px-6 font-semibold w-fit cursor-pointer"
								>
									Try again
								</motion.button>
							)}
						</AnimatePresence>
					</div>
					<div className="relative" onClick={() => setFailed(true)}>
						<motion.div
							animate={{
								opacity: isLoading || didFail ? 0.1 : 1,
								filter: isLoading || didFail ? 'blur(2px)' : 'blur(0px)',
							}}
							className="size-60 flex items-center justify-center rounded-[20px] px-3 py-10 bg-white border border-border transition"
						>
							<QRCode size={210} data="https://world.org" />
						</motion.div>
						<AnimatePresence>
							{(isLoading || didFail) && (
								<motion.div
									exit={{ opacity: 0 }}
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									className="absolute inset-0 flex items-center justify-center"
								>
									{isLoading && <SpinnerIcon className="size-10 animate-spin transition" />}
									{didFail && <FailedIcon className="size-10 animate-spin transition" />}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>
			</main>

			<footer className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between font-light text-xs max-w-[1800px] mx-auto w-full">
				<p>™ 2025 World</p>
				<ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:gap-x-7 md:flex md:flex-wrap md:gap-x-5 xl:gap-x-8 col-span-8 col-start-1 sm:col-span-5 sm:col-start-5 md:col-span-12 md:col-start-3 md:ms-[-1.5em] lg:ms-0">
					<a href="#">Cookie settings</a>
					<a href="https://world.org/legal/cookie-policy" target="_blank">
						Cookie policy
					</a>
					<a href="https://world.org/legal/privacy-notice" target="_blank">
						Privacy notice
					</a>
					<a href="https://world.org/legal/trademark" target="_blank">
						Trademark policy
					</a>
					<a href="https://www.toolsforhumanity.com/legal/law-enforcement-requests" target="_blank">
						Data requests
					</a>
					<a href="https://world.org/legal/user-terms-and-conditions" target="_blank">
						User terms
					</a>
					<a href="https://world.org/risks" target="_blank">
						Risks
					</a>
					<a href="https://world.org/ca" target="_blank">
						Community alerts
					</a>
				</ul>
			</footer>
		</div>
	)
}
