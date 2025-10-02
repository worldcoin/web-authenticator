import { FC, SVGAttributes } from 'react'

const SpinnerIcon: FC<SVGAttributes<SVGElement>> = props => (
	<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 40 40" {...props}>
		<circle cx="20" cy="20" r="18.5" stroke="#191c20" strokeOpacity=".16" strokeWidth="3" />
		<path fill="#181818" d="M29.82 2.577a20 20 0 0 0-19.269-.204l1.39 2.591a17.06 17.06 0 0 1 16.436.174z" />
	</svg>
)

export default SpinnerIcon
