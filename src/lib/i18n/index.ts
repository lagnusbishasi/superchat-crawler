import config from '../../skhema';

import en from './en';
import jp from './jp';

const lang = generateLang();

export interface Lang {
  There_is_no_live_stream_this_channel_hosting: string,
  This_page_does_not_play_stream: string,
  Something_went_wrong: string,
  Youtube_DOM_structure_is_updated: string,
}

function generateLang() : Lang {
  const lang = config.language;

  switch (lang) {
    case 'en':
      return en
  }

  console.warn(`The set option for config.language is not expected: ${lang}. Start with using default language 'en'.`);
  return en
}

export default lang
