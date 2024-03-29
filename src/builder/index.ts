import { copy, copyFile, ensureDir, mkdirp, readdir, readFile, stat, writeFile } from 'fs-extra';
import * as MDI from 'markdown-it';
import * as mdiReplaceLinkPlugin from 'markdown-it-replace-link';
import { basename, dirname, posix, relative, resolve } from 'path';
import yargs = require('yargs');
import { Chapter, Data, Folder, Node } from '../Data';
import { parse } from '../wtcd/parse';
import { countCertainWord } from './countCertainWord';
import { countChars } from './countChars';
import { countParagraphs } from './countParagraphs';
import { isAttachment, isDocument } from './fileExtensions';
import { keywords } from './keywords';
import { PrefixedConsole } from './PrefixedConsole';

const { join } = posix;

const earlyAccessFlag = '# 编写中';
const commentsUrlBegin = '[评论](';
const commentsUrlEnd = ')';

const argv = yargs.options({
  debug: { type: 'boolean', default: false },
}).argv;

(async () => {
  const rootDir = resolve(__dirname, '../..');
  const staticDir = resolve(rootDir, 'static');
  const chaptersDir = resolve(rootDir, 'chapters');
  const distDir = resolve(rootDir, 'dist');
  const distChapters = resolve(distDir, 'chapters');

  console.info(distChapters);

  await ensureDir(distChapters);

  // Copy static
  await copy(staticDir, distDir);
  const indexPath = resolve(distDir, 'index.html');
  const nowTime = new Date().getTime();
  let result = await readFile(indexPath, 'utf-8');
  result = result.replace(new RegExp('js" defer>', 'g'), 'js?v=' + nowTime + '" defer>');
  result = result.replace(new RegExp('css">', 'g'), 'css?v=' + nowTime + '">');
  await writeFile(indexPath, result, 'utf-8');
  console.info('Static copied.');

  const chapterDefaultNamer = (displayIndex: number) => `第 ${displayIndex} 章`;
  const folderDefaultNamer = (displayIndex: number) => `新建文件夹（${displayIndex}）`;

  // Get basic displayName, displayIndex, name, relativePath from a full path
  function destructPath(fullPath: string, isFolder: boolean): Node {
    const relativePath = relative(chaptersDir, fullPath);
    let name = basename(relativePath);
    // Remove extension
    if (!isFolder) {
      name = name.substr(0, name.lastIndexOf('.'));
    }
    const split = name.split(' - ');
    const displayIndex = +split[0];
    let displayName: string;
    if (split.length === 1) {
      // No specified display name
      displayName = (isFolder ? folderDefaultNamer : chapterDefaultNamer)(displayIndex);
    } else {
      displayName = split[1];
    }
    return {
      displayName,
      displayIndex,
      name,
      sourceRelativePath: relativePath,
    };
  }

  let charsCount = 0;
  let paragraphsCount = 0;
  const keywordsCount: Map<string, number> = new Map();
  keywords.forEach(keyword => {
    keywordsCount.set(keyword, 0);
  });

  function getHtmlRelativePath(parentHtmlRelativePath: string, fileName: string) {
    return ((parentHtmlRelativePath + '/').substr(1) /* Remove "/" in the beginning */ + fileName).split(' ').join('-');
  }

  function createMDI(htmlRelativePath: string) {
    return new MDI({
      replaceLink(link: string) {
        if (!link.startsWith('./')) {
          return link;
        }
        if (isAttachment(link)) {
          return join('./chapters', dirname(htmlRelativePath), link);
        }
        if (isDocument(link)) {
          return '#' + join(dirname(htmlRelativePath), link);
        }
      },
    } as MDI.Options).use(mdiReplaceLinkPlugin);
  }

  async function loadMarkdownChapter(path: string, parentHtmlRelativePath: string): Promise<Chapter> {
    let markdown = (await readFile(path)).toString();
    let isEarlyAccess = false;
    if (markdown.startsWith(earlyAccessFlag)) {
      isEarlyAccess = true;
      markdown = markdown.substr(earlyAccessFlag.length).trimLeft();
    }

    let commentsUrl: string | null = null;
    if (markdown.startsWith(commentsUrlBegin)) {
      const commentsUrlBeginIndex = commentsUrlBegin.length;
      const commentsUrlEndIndex = markdown.indexOf(commentsUrlEnd, commentsUrlBeginIndex);
      commentsUrl = markdown.substring(commentsUrlBeginIndex, commentsUrlEndIndex);
      markdown = markdown.substr(commentsUrlEndIndex + 1).trimLeft();
    }

    const chapterCharCount = countChars(markdown);
    charsCount += chapterCharCount;

    keywords.forEach(keyword => {
      const count = countCertainWord(markdown, keyword);
      if (count !== 0) {
        keywordsCount.set(keyword, keywordsCount.get(keyword)! + count);
      }
    });

    const node = destructPath(path, false);
    const htmlRelativePath = getHtmlRelativePath(parentHtmlRelativePath, node.displayName + '.html');

    const mdi =  createMDI(htmlRelativePath);

    const output = mdi.render(markdown);
    paragraphsCount += countParagraphs(output);

    const htmlPath = resolve(distChapters, htmlRelativePath);

    await mkdirp(dirname(htmlPath));

    await writeFile(htmlPath, output);
    console.info(`${node.sourceRelativePath} (${node.displayName}) rendered to ${htmlPath}.`);

    return {
      ...node,
      type: 'Markdown',
      isEarlyAccess,
      commentsUrl,
      htmlRelativePath,
      chapterCharCount,
    };
  }

  async function loadWTCDChapter(path: string, parentHtmlRelativePath: string): Promise<Chapter> {
    const source = (await readFile(path, 'utf8'));
    const node = destructPath(path, false);
    const htmlRelativePath = getHtmlRelativePath(parentHtmlRelativePath, node.displayName + '.html');
    const mdi = createMDI(htmlRelativePath);

    console.info(`Start parsing WTCD for ${node.sourceRelativePath}`);
    const logger = new PrefixedConsole('WTCD:', console);
    const htmlPath = resolve(distChapters, htmlRelativePath);
    await mkdirp(dirname(htmlPath));

    let chapterCharCount = 0;

    const wtcdParseResult = parse({ source, mdi, logger, sourceMap: argv.debug, markdownPreProcessor: markdown => {
      chapterCharCount += countChars(markdown);
      keywords.forEach(keyword => {
        const count = countCertainWord(markdown, keyword);
        if (count !== 0) {
          keywordsCount.set(keyword, keywordsCount.get(keyword)! + count);
        }
      });
      return markdown;
    }, htmlPostProcessor: html => {
      paragraphsCount += countParagraphs(html);
      return html;
    }});

    charsCount += chapterCharCount;

    if (wtcdParseResult.error) {
      logger.error(wtcdParseResult.internalStack);
    }
    await writeFile(htmlPath, JSON.stringify(wtcdParseResult));

    console.info(`${node.sourceRelativePath} (${node.displayName}) parsed to ${htmlPath}.`);

    return {
      ...node,
      type: 'WTCD',
      isEarlyAccess: false,
      commentsUrl: null,
      htmlRelativePath,
      chapterCharCount,
    };
  }

  async function copyResource(path: string, parentHtmlRelativePath: string): Promise<void> {
    const targetRelativePath = getHtmlRelativePath(parentHtmlRelativePath, basename(path));
    const targetPath = resolve(distChapters, targetRelativePath);
    await mkdirp(dirname(targetPath));
    await (copyFile as any)(path, targetPath);

    console.info(`${path} copied to ${targetPath}.`);
  }

  interface HasDisplayIndex {
    displayIndex: number;
  }
  function byDisplayIndex(a: HasDisplayIndex, b: HasDisplayIndex) {
    return a.displayIndex - b.displayIndex;
  }

  async function loadFolder(path: string, parentHtmlRelativePath: string, isRoot: boolean): Promise<Folder> {
    const node = destructPath(path, true);
    const htmlRelativePath = isRoot ? '' : (parentHtmlRelativePath + '/' + node.displayName);
    const names = await readdir(path);
    // Collect all promises created for loading subdirs
    const subDirsLoadingPromises: Array<Promise<Folder>> = [];
    const chaptersLoadingPromises: Array<Promise<Chapter>> = [];
    for (const name of names) {
      const subpath = resolve(path, name);
      const isDirectory = (await stat(subpath)).isDirectory();
      if (isDirectory) {
        subDirsLoadingPromises.push(loadFolder(subpath, htmlRelativePath, false));
      } else {
        if (isAttachment(subpath)) {
          await copyResource(subpath, htmlRelativePath);
        }
        if (subpath.endsWith('.md')) {
          chaptersLoadingPromises.push(loadMarkdownChapter(subpath, htmlRelativePath));
        }
        if (subpath.endsWith('.wtcd')) {
          chaptersLoadingPromises.push(loadWTCDChapter(subpath, htmlRelativePath));
        }
      }
    }

    const chapters = (await Promise.all(chaptersLoadingPromises)).sort(byDisplayIndex);
    const subFolders = (await Promise.all(subDirsLoadingPromises)).sort(byDisplayIndex);

    return {
      ...node,
      isRoot,
      chapters,
      subFolders,
      folderCharCount: chapters.reduce((count, chapter) => count += chapter.chapterCharCount, 0) +
        subFolders.reduce((count, folder) => count += folder.folderCharCount, 0),
    };
  }

  const data: Data = {
    chapterTree: await loadFolder(chaptersDir, '', true),
    charsCount,
    paragraphsCount,
    keywordsCount: [...keywordsCount].sort((a, b) => b[1] - a[1]),
    buildNumber: process.env.TRAVIS_BUILD_NUMBER || 'Unoffical',
  };
  await writeFile(
    resolve(distDir, 'data.js'),
    `window.DATA=${JSON.stringify(data, null, 2)};`,
  );
  console.info('data.js created.');
})();
