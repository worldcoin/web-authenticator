import './globals.css'
import LocalFont from 'next/font/local'

const tiempos = LocalFont({
	preload: true,
	display: 'swap',
	adjustFontFallback: false,
	variable: '--raw-font-tiempos',
	src: '../fonts/TiemposHeadline-Regular.ttf',
})

const twkLausanne = LocalFont({
	preload: true,
	display: 'swap',
	adjustFontFallback: false,
	variable: '--raw-font-twk-lausanne',
	src: [
		{ path: '../fonts/TWKLausanne-300.otf', weight: '300', style: 'normal' },
		{ path: '../fonts/TWKLausanne-400.otf', weight: '400', style: 'normal' },
		{ path: '../fonts/TWKLausanne-600.otf', weight: '600', style: 'normal' },
	],
})

const RootLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
	<html lang="en">
		<body className={`${tiempos.variable} ${twkLausanne.variable} antialiased font-brand`}>{children}</body>
	</html>
)

export default RootLayout
