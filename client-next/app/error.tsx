'use client';

export default function ErrorPage({ unstable_retry }: { unstable_retry: () => void }) {
  return <div className="p-8 space-y-3" role="alert">
    <h1 className="text-lg font-semibold">页面数据加载失败</h1>
    <p>请检查后台服务和网络连接，然后重试。</p>
    <button type="button" className="underline" onClick={unstable_retry}>重新加载</button>
  </div>;
}
