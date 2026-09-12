import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import '../identity.css';
export function AuthFrame({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  return <div className="login-page"><section className="login-story"><Link to="/login" className="brand"><span className="brand-mark">大</span><span>Daifuku<small>YOUR BUSINESS, CONNECTED</small></span></Link><h2>{t({ ja: '日々の仕事に、\n心地よい見通しを。', en: 'A clearer view of\nyour everyday business.' }).split('\n').map((line) => <span className="block" key={line}>{line}</span>)}</h2><p>{t({ ja: '人と店舗、数字をつなぐ。いつもの仕事へ、安心してアクセス。', en: 'Connect people, locations and numbers. Secure access to your everyday work.' })}</p><div className="login-steps"><span><Icon name="document" size={18} /></span><span>{t({ ja: '記録する', en: 'Record' })}</span><span>{t({ ja: 'つながる', en: 'Connect' })}</span><span>{t({ ja: '見渡せる', en: 'Understand' })}</span></div></section><div className="login-form-wrap"><div className="login-form auth-content"><button type="button" className="auth-language" onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}>{locale === 'ja' ? 'English' : '日本語'}</button>{children}</div></div></div>;
}
