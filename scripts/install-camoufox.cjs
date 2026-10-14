// Install only the paired browser; no fingerprint model, GeoIP database or addon is needed.
const { findInstalledVersion } = require('../server/node_modules/camoufox');
const { CamoufoxFetcher, RepoConfig, AvailableVersion, Version } = require('../server/node_modules/camoufox/dist/pkgman.js');
const VERSION = '156.0.1-beta.36';
async function install() {
  if (await findInstalledVersion(`official/${VERSION}`)) { console.log(`Camoufox ${VERSION} 已安装`); return; }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) {
    const sdkRequire = require('node:module').createRequire(require.resolve('../server/node_modules/camoufox'));
    const { Impit } = sdkRequire('impit');
    const transport = new Impit({ proxyUrl: proxy, timeout: 3600000 });
    globalThis.fetch = transport.fetch.bind(transport);
  }
  const platform = process.platform === 'win32' && process.arch === 'x64' ? 'win.x86_64'
    : process.platform === 'linux' && process.arch === 'x64' ? 'lin.x86_64'
    : process.platform === 'linux' && process.arch === 'arm64' ? 'lin.arm64' : null;
  if (!platform) throw new Error('项目浏览器安装仅支持 Windows x64、Linux x64 与 Linux ARM64');
  const selected = new AvailableVersion({ version: new Version('beta.36', '156.0.1'), isPrerelease: false, interface: 1,
    url: `https://github.com/daijro/camoufox/releases/download/v${VERSION}/camoufox-${VERSION}-${platform}.zip` });
  const fetcher = await new CamoufoxFetcher(RepoConfig.getDefault(), selected).init();
  await fetcher.install();
  if (!await findInstalledVersion(`official/${VERSION}`)) throw new Error('未找到安装后的固定浏览器包');
  console.log(`Camoufox ${VERSION} 安装完成`);
}
install().catch(error => { console.error(error.message); process.exitCode = 1; });
