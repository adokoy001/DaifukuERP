// Text normalisation used by field `normalize` options. Japanese bank formats require half-width kana (research/04 §B7).

const KANA_TABLE: Record<string, string> = {
  ア: 'ｱ', イ: 'ｲ', ウ: 'ｳ', エ: 'ｴ', オ: 'ｵ', カ: 'ｶ', キ: 'ｷ', ク: 'ｸ', ケ: 'ｹ', コ: 'ｺ',
  サ: 'ｻ', シ: 'ｼ', ス: 'ｽ', セ: 'ｾ', ソ: 'ｿ', タ: 'ﾀ', チ: 'ﾁ', ツ: 'ﾂ', テ: 'ﾃ', ト: 'ﾄ',
  ナ: 'ﾅ', ニ: 'ﾆ', ヌ: 'ﾇ', ネ: 'ﾈ', ノ: 'ﾉ', ハ: 'ﾊ', ヒ: 'ﾋ', フ: 'ﾌ', ヘ: 'ﾍ', ホ: 'ﾎ',
  マ: 'ﾏ', ミ: 'ﾐ', ム: 'ﾑ', メ: 'ﾒ', モ: 'ﾓ', ヤ: 'ﾔ', ユ: 'ﾕ', ヨ: 'ﾖ', ラ: 'ﾗ', リ: 'ﾘ',
  ル: 'ﾙ', レ: 'ﾚ', ロ: 'ﾛ', ワ: 'ﾜ', ヲ: 'ｦ', ン: 'ﾝ',
  ガ: 'ｶﾞ', ギ: 'ｷﾞ', グ: 'ｸﾞ', ゲ: 'ｹﾞ', ゴ: 'ｺﾞ', ザ: 'ｻﾞ', ジ: 'ｼﾞ', ズ: 'ｽﾞ', ゼ: 'ｾﾞ', ゾ: 'ｿﾞ',
  ダ: 'ﾀﾞ', ヂ: 'ﾁﾞ', ヅ: 'ﾂﾞ', デ: 'ﾃﾞ', ド: 'ﾄﾞ', バ: 'ﾊﾞ', ビ: 'ﾋﾞ', ブ: 'ﾌﾞ', ベ: 'ﾍﾞ', ボ: 'ﾎﾞ',
  パ: 'ﾊﾟ', ピ: 'ﾋﾟ', プ: 'ﾌﾟ', ペ: 'ﾍﾟ', ポ: 'ﾎﾟ', ヴ: 'ｳﾞ',
  ァ: 'ｧ', ィ: 'ｨ', ゥ: 'ｩ', ェ: 'ｪ', ォ: 'ｫ', ッ: 'ｯ', ャ: 'ｬ', ュ: 'ｭ', ョ: 'ｮ',
  ー: 'ｰ', '。': '｡', '、': '､', '「': '｢', '」': '｣', '・': '･', '　': ' ', '゛': 'ﾞ', '゜': 'ﾟ',
};

/** Full-width katakana/hiragana/alnum -> half-width. Characters without a mapping are kept. */
export function toHalfwidthKana(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    // hiragana -> katakana first
    const kata = code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : ch;
    const mapped = KANA_TABLE[kata];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const kc = kata.codePointAt(0) ?? 0;
    // full-width ASCII range (！ .. ～)
    if (kc >= 0xff01 && kc <= 0xff5e) {
      out += String.fromCodePoint(kc - 0xfee0);
      continue;
    }
    out += kata;
  }
  return out;
}

export function normalizeText(mode: 'trim' | 'halfwidth-kana' | 'upper' | undefined, value: string): string {
  switch (mode) {
    case 'trim':
      return value.trim();
    case 'halfwidth-kana':
      return toHalfwidthKana(value.trim()).toUpperCase();
    case 'upper':
      return value.trim().toUpperCase();
    default:
      return value;
  }
}
