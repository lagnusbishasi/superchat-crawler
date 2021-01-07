import { Browser, Page, Frame, ElementHandle } from 'puppeteer';

import fileSystem from './file-system';
import config from './skhema';
import lang from './lib/i18n/index';

const DEFAULT_WIDTH = config.window.width;
const DEFAULT_HEIGHT = config.window.height;
const DEFAULT_TIMEOUT = config.network.timeout;

const CHECK_LIVE_MARGIN_MS = config.network.period.check_live;
const CAPTURE_MARGIN = config.network.period.capture;

const MAKE_ANONYMOUS = config.capture.anonymous;
const FONT_OVERIDE_NAME = config.capture.font.name;
const FONT_OVERIDE_URL = config.capture.font.url;
const CAPTURE_DIRECTORY = config.capture.directory;

// HardLimit CONSTANT
const BLUR_AMOUNT = 3;

// Elems CONSTANT
const CHANNEL_NAME_SELECTOR = '#text.ytd-channel-name';

const LIVE_BADGE_SELECTOR = '[overlay-style="LIVE"]';
const CHAT_IFRAME_SELECTOR = '#chatframe';

const SUPERCHAT_CONTAINER_SELECTOR = '#container .yt-live-chat-ticker-renderer';
const SUPERCHAT_UNPAIED_MESSAGE_SELECTOR = '#contents yt-live-chat-text-message-renderer';
const SUPERCHAT_ITEM_SELECTOR = 'yt-live-chat-ticker-paid-message-item-renderer';
const SUPERCHAT_RENDERER_SELECTOR = '#message';
const SUPERCHAT_CARD_SELECTOR = '#message .yt-live-chat-paid-message-renderer';
const SUPERCHAT_CARD_AUTHOR_SELECTOR = '#author-name';
const SUPERCHAT_CARD_IMAGE_SELECTOR = '#author-photo';

const POPOVER_SELECTOR = '#contentWrapper .ytd-popup-container';

// Title CONSTANT
const YOUTUBE_SUFFIX = ' - YouTube';

// URL CONSTANT
const YOUTUBE_CHANNEL_URL_BASE = 'https://www.youtube.com/channel/'

type LiveStatus = 'NOT_LIVE' | 'WATCHING' | 'LIVE' | 'KILLED';

interface ChannelExplorerConfig {
  width? : number;
  height? : number;
}

async function sleep(sleepSecondMS : number) {
  await new Promise((resolve) => {
    setTimeout(resolve, sleepSecondMS);
  })

  return true
}

export class ChannelExplorer {
  private browser : Browser;
  private channelURL : string;
  private streamURL? : string;
  private config : ChannelExplorerConfig;

  protected page? : Page;
  protected channelName : string;
  protected streamTitle : string;
  protected streamId? : string;

  liveStatus : LiveStatus;

  constructor(browser : Browser, channel : string, config={}) {
    this.browser = browser;
    this.channelURL = `${YOUTUBE_CHANNEL_URL_BASE}${channel}`;
    this.config = this._prepareConfig(config);

    this.liveStatus = 'NOT_LIVE';
  }

  async waitForLive() {
    await this._gotoChannel();

    this.liveStatus = 'WATCHING';

    while (this.liveStatus == 'WATCHING') {
      this._deleteAutoPlayVideos();

      const isLive = await this._checkIsLive();

      if (isLive)
        break;

      await this.page.waitForTimeout(CHECK_LIVE_MARGIN_MS)

      await this._reload();
    }

    return true
  }

  async openLiveStream() {
    if (!this.streamURL)
      return console.error(lang.There_is_no_live_stream_this_channel_hosting), undefined

    await this.page.goto(this.streamURL);

    const fullStreamTitle = await this.page.title();
    this.streamTitle = fullStreamTitle.split(YOUTUBE_SUFFIX)[0];

    console.log(`[${this.channelName}] started streaming: ${this.streamTitle}`);
  }

  terminate() {
    this.liveStatus = 'KILLED';
  }

  private async _deleteAutoPlayVideos() {
    const videos = await this.page.$$('video')
      .catch(() => []);

    for (const video of videos) {
      video.evaluate((node : Element) => {
        node.parentElement.removeChild(node);
      })
    }
  }

  private async _reload() {
    await this.page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] })
      .catch(() => { console.error(lang.Something_went_wrong) })
  }

  private _prepareConfig(config : ChannelExplorerConfig) : ChannelExplorerConfig {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      ...config
    };
  }

  private async _preparePage() {
    if (this.page)
      return undefined

    this.page = await this.browser.newPage();

    await this.page.setViewport({
      width: this.config.width,
      height: this.config.height,
      deviceScaleFactor: 1
    })
    this.page.setDefaultTimeout(DEFAULT_TIMEOUT);
  }

  private _getLiveStreamURLFromLiveBadge(node : HTMLElement) {
    const overlay = node.parentElement;

    if (overlay && overlay.id != 'overlays')
      throw new Error(lang.Youtube_DOM_structure_is_updated)

    const thumbnail = overlay.parentElement;

    if (thumbnail && thumbnail.id != 'thumbnail')
      throw new Error(lang.Youtube_DOM_structure_is_updated)

    const relativeStreamURL = thumbnail.getAttribute('href');

    return relativeStreamURL
  }

  private async _checkIsLive() {
    const liveBadge = await this.page.waitForSelector(LIVE_BADGE_SELECTOR)
      .then((node) => node)
      .catch(() => undefined)

    if (!liveBadge)
      return false

    this.liveStatus = 'LIVE';

    const url = new URL(this.page.url());
    const relativeStreamURL = await liveBadge.evaluate(this._getLiveStreamURLFromLiveBadge);

    this.streamURL = `${url.origin}${relativeStreamURL}`;
    this.streamId = this._getIdOfLiveStream();

    return true
  }

  private _getIdOfLiveStream() {
    if (!this.streamURL)
      return console.error(lang.Something_went_wrong), undefined

    const url = new URL(this.streamURL);
    const params = new URLSearchParams(url.search);

    return params.get('v')
  }

  private async _gotoChannel() {
    await this._preparePage();
    await this.page.goto(this.channelURL);

    const channelName = await this.page.waitForSelector(CHANNEL_NAME_SELECTOR);

    this.channelName = await channelName.evaluate((node : Element) => {
      if (node instanceof HTMLElement)
        return node.innerText
    })
  }
}

export class ChatObserver extends ChannelExplorer {
  private streamDirectory : string;
  private cachedUnpaidMessageId : string;
  private cachedSuperChat : Map<string, boolean>;
  private chatFrame : Frame;
  private chatTicketRenderer : ElementHandle;

  constructor(browser : Browser, channelURL : string, config={}) {
    super(browser, channelURL, config)

    this.cachedSuperChat = new Map();
  }

  async observe(waitTime : number) {
    await sleep(waitTime);

    while (this.liveStatus !== 'KILLED') {
      await this.waitForLive();
      await this.openLiveStream();

      await this._observeChatToCollectSuperChat();
    }
  }

  async _observeChatToCollectSuperChat() {
    if (!this.page.url().includes('watch'))
      return console.error(lang.This_page_does_not_play_stream)

    this._generateStreamDirectory();

    const chatIframe = await this.page.waitForSelector(CHAT_IFRAME_SELECTOR);
    this.chatFrame = await chatIframe.contentFrame();
    this.chatTicketRenderer = await this.chatFrame.waitForSelector(SUPERCHAT_CONTAINER_SELECTOR);

    this._popoverBlocker();

    if (MAKE_ANONYMOUS)
      this._makeAnonymous();

    if (FONT_OVERIDE_NAME)
      this._overideFont();

    while (this.liveStatus == 'LIVE') {
      await this._collectSuperChat();

      await this.page.waitForTimeout(CAPTURE_MARGIN);

      await this._checkStreamStillOnLiveByChat();
    }
  }

  // Check if the stream is still on live by checking the content of chat is refreshed.
  // TODO: Invent more precise way to observe it.
  private async _checkStreamStillOnLiveByChat() {
    const unpaidMessages = await this.chatFrame.$$(SUPERCHAT_UNPAIED_MESSAGE_SELECTOR);

    const newId = await unpaidMessages[unpaidMessages.length - 1].evaluate((node : Element) => {
      if (node instanceof HTMLElement)
        return node.id
    });

    if (this.cachedUnpaidMessageId !== newId) {
      this.cachedUnpaidMessageId = newId;
      return undefined
    }

    this.cachedUnpaidMessageId = undefined;
    this.liveStatus = 'NOT_LIVE';

    console.log(`[${this.channelName}] stopped streaming: ${this.streamTitle}`);
  }

  private _generateStreamDirectory() {
    this.streamDirectory = `./${CAPTURE_DIRECTORY}/${this.streamId}`;

    fileSystem.createDirectoryIfNotExist(this.streamDirectory);
  }

  // Checking by clicking badge.
  // SuperChat that displays in chat is not consistant 'cause it could disappears pretty fast when stupid chat messages are spammed.
  private async _collectSuperChat() {
    const badges = await this.chatTicketRenderer.$$(SUPERCHAT_ITEM_SELECTOR);

    // This procedure cannot be concurrent 'cause including click and capture process.
    for (const badge of badges) {
      const superChatId = await badge.evaluate((elem : Element) => elem.id);

      const isCached = this.cachedSuperChat.get(superChatId);
      if (isCached)
        continue

      // Click requires `bringToFront` (activate the tab) before it.
      // However, capturing is suspended when `bringToFront` in other opening tabs  fires before `click` fires.
      await this.page.bringToFront();
      await badge.click();

      const renderer = await this.chatFrame.waitForSelector(SUPERCHAT_RENDERER_SELECTOR);
      const card = await this.chatFrame.waitForSelector(SUPERCHAT_CARD_SELECTOR);
      if (!renderer || !card) {
        console.error(lang.Something_went_wrong);
        continue;
      }

      const filePath = `${this.streamDirectory}/${superChatId}.png`;

      card.screenshot({ path: filePath })

      console.log(`- Captured SuperChat as ${filePath}`);

      await renderer.evaluate((node : Element) => {
        if (node instanceof HTMLElement)
          node.removeChild(node.firstElementChild);
      })

      this.cachedSuperChat.set(superChatId, true);
    }
  }

  private async _popoverBlocker() {
    this.page.addStyleTag({
      content: `
        ${POPOVER_SELECTOR} {
          display: none !important;
        }
      `
    })
  }

  private async _makeAnonymous() {
    await this.chatFrame.addStyleTag({
      content: `
        ${SUPERCHAT_CARD_IMAGE_SELECTOR},
        ${SUPERCHAT_CARD_AUTHOR_SELECTOR} {
          filter: blur(${BLUR_AMOUNT}px);
        }
      `
    })
  }

  private async _overideFont() {
    const fontImport = FONT_OVERIDE_URL
      ? `
        @import url('${FONT_OVERIDE_URL}');
      ` : ''

    await this.chatFrame.addStyleTag({
      content: `
        ${fontImport}

        ${SUPERCHAT_CARD_SELECTOR} {
          font-family: ${FONT_OVERIDE_NAME}
        }
      `
    })
  }
}
