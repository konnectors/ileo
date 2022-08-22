process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://78779cc5c54e4764a99490358f60eed4@errors.cozycloud.cc/47'

const {
  BaseKonnector,
  requestFactory,
  scrape,
  log,
  cozyClient
} = require('cozy-konnector-libs')
const request = requestFactory({
  // The debug mode shows all the details about HTTP requests and responses. Very useful for
  // debugging but very verbose. This is why it is commented out by default
  debug: true,
  // Activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // This allows request-promise to keep cookies between requests
  jar: true
})

const VENDOR = 'ileo'
const baseUrl = 'https://www.mel-ileo.fr'
const models = cozyClient.new.models
const { Qualification } = models.document

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
// cozyParameters are static parameters, independents from the account. Most often, it can be a
// secret api key.
async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/mon-espace-compte-consulter-facture.aspx`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($, fields.login)

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  log('info', fields, 'fields')
  await this.saveBills(documents, fields.folderPath, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['Eau De La Metropole']
  })
}

// This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
async function authenticate(username, password) {
  const loginForm = {
    login: username,
    pass: password,
    connect: 'OK'
  }
  const res = await request.post(`${baseUrl}/default.aspx`, {
    form: loginForm,
    resolveWithFullResponse: true,
    simple: false
  })
  log('debug', 'res.req.path', res.req.path)
  if (res.req.path != '/mon-espace-perso.aspx') {
    throw new Error('LOGIN_FAILED')
  }
}

// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($, login) {
  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const refContract = login
  const docs = scrape(
    $,
    {
      date: {
        sel: 'td:nth-child(1)',
        parse: text => text.replace(/\//g, '-').trim()
      },
      billNumber: {
        sel: 'td:nth-child(2)'
      },
      amount: {
        sel: 'td:nth-child(3)',
        parse: normalizePrice
      },
      billPath: {
        sel: 'td:nth-child(5) a',
        attr: 'href'
      }
    },
    '#mieux-consommer table tbody tr:not(:first-child)'
  )
  return docs.map(bill => {
    const date = normalizeDate(bill.date)
    var data = {
      ...bill,
      refContract,
      filename: `${formatDate(date)}_${bill.billNumber}_${bill.amount}EUR.pdf`,
      currency: '€',
      date: date,
      vendor: VENDOR,
      vendorRef: bill.billNumber,
      amount: parseFloat(bill.amount),
      qualification: Qualification.getByLabel('water_invoice')
    }
    if (bill.billPath) {
      data['fileurl'] = `${baseUrl}/${bill.billPath}`
    }
    return data
  })
}

function normalizeDate(date) {
  const [day, month, year] = date.split('-')
  return new Date(`${year}-${month}-${day}`)
}

// Convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}

// Return a string representation of the date that follows this format:
// "YYYY-MM-DD". Leading "0" for the day and the month are added if needed.
function formatDate(date) {
  let month = date.getMonth() + 1
  if (month < 10) {
    month = '0' + month
  }

  let day = date.getDate()
  if (day < 10) {
    day = '0' + day
  }

  let year = date.getFullYear()

  return `${year}${month}${day}`
}
