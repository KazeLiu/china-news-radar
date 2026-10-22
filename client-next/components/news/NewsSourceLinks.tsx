import styles from './NewsSourceLinks.module.css';

export function NewsSourceLinks({ links }: { links: string[] }) {
  if (!links.length) return null;
  return <div className={styles.links} aria-label="消息中的外部链接"><span>消息外链：</span>{links.map(url => <a key={url} href={url} title={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname.replace(/^www\./, '')}</a>)}</div>;
}
