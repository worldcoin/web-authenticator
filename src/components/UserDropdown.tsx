'use client'

import { FC } from 'react'
import Image from 'next/image'
import LogOutIcon from './icons/LogOutIcon'
import CheckmarkIcon from './icons/CheckmarkIcon'
import { StaticImport } from 'next/dist/shared/lib/get-img-props'
import {
	DropdownMenu as DropdownRoot,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuItem,
} from '@radix-ui/react-dropdown-menu'

type Props = {
	onLogOut?: () => void
	marble: string | StaticImport
	passport?: { country: string; flag: string | StaticImport }
}

const UserDropdown: FC<Props> = ({ marble, passport, onLogOut }) => (
	<DropdownRoot>
		<DropdownMenuTrigger asChild>
			<button className="cursor-pointer focus:outline-none">
				<Image
					width={28}
					height={28}
					src={marble}
					alt="World ID Marble"
					className="size-7 rounded-full outline outline-border outline-offset-1"
				/>
			</button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" className="mt-2 p-1 rounded-2xl bg-white border border-border shadow">
			<DropdownMenuItem className="py-2 px-3 rounded-xl text-sm focus:outline-none cursor-default" disabled>
				<div className="flex items-center gap-1">
					<CheckmarkIcon className="inline size-5 text-secondary" />
					<p>Unique Human</p>
				</div>
			</DropdownMenuItem>
			{passport && (
				<DropdownMenuItem className="py-2 px-3 rounded-xl text-sm focus:outline-none cursor-default" disabled>
					<div className="flex items-center gap-1">
						<Image src={passport.flag} alt={passport.country} className="inline size-5 text-secondary" />
						<p>Passport</p>
					</div>
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator className="h-px bg-border my-1" />
			<DropdownMenuItem
				asChild
				className="py-2 px-3 hover:bg-[#F4F3F1] rounded-xl text-sm focus:outline-none cursor-pointer"
			>
				<button className="flex items-center gap-1 w-full" onClick={onLogOut}>
					<LogOutIcon className="inline size-5 text-secondary" />
					<p>Log out</p>
				</button>
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownRoot>
)

export default UserDropdown
