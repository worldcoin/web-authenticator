import { FC, SVGAttributes } from 'react'

const FailedIcon: FC = () => (
	<svg viewBox="0 0 40 40" width={40} height={40} xmlns="http://www.w3.org/2000/svg">
		<g fill="none" fillRule="evenodd">
			<rect fill="#848382" fillRule="nonzero" width="40" height="40" rx="20"></rect>
			<path
				d="M15.0063,24.5388 L19.7723,19.7727 M24.5383,15.0067 L19.7723,19.7727 M19.7723,19.7727 L15.0063,15.0067 M19.7723,19.7727 L24.5383,24.5388"
				stroke="#FFFFFF"
				strokeWidth="1.36364"
			/>
		</g>
	</svg>
)

export default FailedIcon
