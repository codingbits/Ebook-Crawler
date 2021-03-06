const request = require('request'),
  cheerio = require('cheerio'),
  async = require('async'),
  iconv = require('iconv-lite'),
  Epub = require('epub-gen'),
  uslug = require('uslug'),
  fs = require('fs'),
  path = require('path')

/**

 ebook crawler

 CHECK README.md for more information

 options: {
  bookName: '',                                // required
  url: 'http://www.piaotian.net/html/0/738/',  // required
  table: function($){ return []}               // required
  content: function($){ return ' '}            // required
  author: '',                                  // optional
  cover: '',                                   // optional
  outputDir: './',                              // optional
  charset: 'utf8',                             // optional
  generateMarkdown: false,                     // optional
  addFrontMatter: false                        // optional
 }
 */
function ebookCrawler(options = {}) {
  const url = options.url,
    table = options.table,
    content = options.content,
    author = options.author,
    bookName = options.bookName,
    cover = options.cover,
    outputDir = options.outputDir || './',
    charset = options.charset || 'utf8',
    addFrontMatter = options.addFrontMatter || false,
    generateMarkdown = options.generateMarkdown || false

  let urls = url
  if (typeof(url) === 'string') {
    urls = [url]
  }

  const requestOption = {
    'encoding': null,
    'timeout': 20000,
    'headers': {
      // 'accept-charset': 'utf-8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36',
    }
  }

  if (!bookName) {
    throw 'bookName is not defined'
    return
  }

  if (!table) {
    throw 'table is not defined'
    return
  }

  if (!content) {
    throw 'content is not defined'
    return
  }

  console.log('start analyzing toc')
  let asyncFunc = urls.map((url) => {
    return function(cb) {
      request(url, requestOption, function(error, response, body) {
        if (!error && response.statusCode === 200) {
          body = new Buffer(body)
          body = iconv.decode(body, charset)

          let $ = cheerio.load(body.toString('utf8'))
          let toc = table($)
          cb(null, toc || [])
        } else {
          throw 'failed to fetch ' + url
          cb(null, [])
        }
      })
    }
  })

  async.parallelLimit(asyncFunc, 50, function(error, tocs) {
    let toc = tocs.reduce((a, b) => a.concat(b))


    let total = toc.length,
      count = 0

    let asyncFunc = toc.map((t) => {
      return function(cb) {
        request(t.url, requestOption, function(error, response, body) {
          count++
          process.stdout.write('                                    \r')
          process.stdout.write(`${count}/${total} finished`)
          if (!error && response.statusCode === 200) {
            body = new Buffer(body);
            body = iconv.decode(body, charset)
            let $ = cheerio.load(body.toString('utf8'))
            t.content = content($, t.title) // save to toc
            cb(null, null)
          } else {
            console.log('\nfailed to fetch ' + t.url)
            t.content = null
            cb(null, null)
          }
        })
      }
    })

    console.log('start downloading...')
    async.parallelLimit(asyncFunc, 50, function(error, results) {
      console.log('\ndone crawling the website')
        // console.log(toc)
        // output file
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir)
      }

      if (generateMarkdown) {
        contentsFolder = path.resolve(outputDir, 'contents')
        if (!fs.existsSync(contentsFolder)) {
          fs.mkdirSync(contentsFolder)
        }

        let summary = `# ${bookName}\n\n`

        if (addFrontMatter) {
          let frontMatter = `---\nebook:\n  title: ${bookName}\n`
          if (cover) {
            frontMatter += `  cover: ${cover}\n`
          }
          if (author) {
            frontMatter += `  authors: ${author}\n`
          }
          frontMatter += '---\n\n'
          summary = frontMatter + summary
        }

        for (let i = 0; i < toc.length; i++) {
          let level = toc[i].level || 0,
            title = toc[i].title,
            url = toc[i].url,
            content = toc[i].content

          let titleSlug = uslug(title)

          if (!content) continue // no content found

          let j = 0
          while (j < level * 2) {
            summary += ' '
            j++
          }
          summary += `* [${title}](./contents/${titleSlug}.md)\n`

          // write file
          fs.writeFile(path.resolve(contentsFolder, `${titleSlug}.md`), content, function(error) {
            if (error) throw error
          })

          // write summary
          fs.writeFile(path.resolve(outputDir, `${bookName}.md`), summary, function(error) {
            if (error) throw error
          })
        }

        // console.log(summary)
        console.log('done creating ebook markdown files')
      }

      // generate epub
      console.log('start creating .epub file')
      let epubOption = {
        title: bookName,
        author: author,
        cover: cover,
        content: toc.filter((t)=> t.content).map((t)=> {
          return {
            title: t.title,
            data: t.content
          }
        })
      }
      new Epub(epubOption, path.resolve(outputDir, `./${bookName}.epub`)).promise.then(function() {
        console.log('done creating .epub file')
      }, function(error) {
        console.log('failed to create .epub file')
      })

    })
  })
}

module.exports = ebookCrawler