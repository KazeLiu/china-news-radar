// Collector credentials are available only on the private backend, never through the reader proxy.
export function GET() { return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
