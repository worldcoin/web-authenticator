import { FC, SVGAttributes } from 'react'

const LogOutIcon: FC<SVGAttributes<SVGElement>> = props => (
	<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 20 20" {...props}>
		<path
			strokeWidth="1.25"
			strokeLinecap="square"
			d="M10 10h5.834m0 0-2.5 2.5m2.5-2.5-2.5-2.5M15.833 5v-.833c0-.92-.747-1.667-1.667-1.667H5.833c-.92 0-1.667.746-1.667 1.667v11.666c0 .92.746 1.667 1.667 1.667h8.333c.92 0 1.667-.746 1.667-1.667V15"
		/>
	</svg>
)

export default LogOutIcon
