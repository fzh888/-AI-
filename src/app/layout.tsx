import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '贪吃的绿皮猪 · 网页弹射小游戏',
  description:
    '一款用 Matter.js 物理引擎做的 2D 网页休闲弹射游戏。扮演绿猪，用投石车把自己射进小鸟看守的木石房子，抢回鸟蛋。',
  keywords: ['网页小游戏', '弹射游戏', '愤怒的小鸟', 'Matter.js', '休闲游戏', '物理游戏'],
  openGraph: {
    title: '贪吃的绿皮猪 · 网页弹射小游戏',
    description: '拉满投石车，把自己射进小鸟的房子，抢回鸟蛋。10 关物理弹射，浏览器直接玩。',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#6cbf3f',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
