// Description: fetches holon info from different sources
// Data layer: HoloSphere (GunDB federation)
import Home from '../home.json'
import HoloSphere from 'holosphere'

let hs = new HoloSphere("Holons")

// Default lenses shown when viewing a holon
const DEFAULT_LENSES = [
  { id: 'quests', label: 'Tasks', lense: 'tasks' },
  { id: 'users', label: 'People', lense: 'users' },
  { id: 'shopping', label: 'Shopping', lense: 'tasks' },
  { id: 'expenses', label: 'Expenses', lense: 'tasks' },
  { id: 'offers', label: 'Offers', lense: 'tasks' },
  { id: 'announcements', label: 'News', lense: 'tasks' },
  { id: 'calendar', label: 'Calendar', lense: 'tasks' },
  { id: 'roles', label: 'Roles', lense: 'tasks' },
  { id: 'settings', label: 'Settings', lense: 'settings' }
]

async function fetchHolon(id, lense) {
  var holon = {}
  
  var parts = id.split('.')
  var holonId = parts[0]
  var sublense = parts[1] || lense
  var itemId = parts[2]

  console.log("HoloSphere fetch - Holon:", holonId, "Lense:", sublense, "Item:", itemId)

  if (!sublense) {
    holon.id = id
    holon.name = holonId
    holon.description = 'Holon: ' + holonId
    holon.holons = DEFAULT_LENSES.map(function(l) {
      return {
        id: holonId + '.' + l.id,
        label: l.label,
        lense: l.lense
      }
    })
    
    try {
      var fedInfo = await hs.getFederation(holonId)
      if (fedInfo && fedInfo.name) {
        holon.name = fedInfo.name
        holon.description = fedInfo.description || holon.description
      }
    } catch(e) {
      console.log("Could not fetch federation info:", e)
    }
    
    return holon
  }

  try {
    var items = await hs.getAll(holonId, sublense)
    holon.id = id
    holon.name = sublense.charAt(0).toUpperCase() + sublense.slice(1)
    holon.description = sublense + ' for ' + holonId
    holon.holons = []

    if (Array.isArray(items)) {
      items.forEach(function(item) {
        var label = item.title || item.name || item.username || item.description || item.id || 'unnamed'
        holon.holons.push({
          id: holonId + '.' + sublense + '.' + (item.id || label),
          label: label,
          lense: sublense,
          payload: item
        })
      })
    } else if (items && typeof items === 'object') {
      Object.keys(items).forEach(function(key) {
        if (key === '_' || key === '#') return
        var item = items[key]
        if (item && typeof item === 'object') {
          var label = item.title || item.name || item.username || item.description || key
          holon.holons.push({
            id: holonId + '.' + sublense + '.' + key,
            label: label,
            lense: sublense,
            payload: item
          })
        }
      })
    }
  } catch(e) {
    console.log("HoloSphere fetch error:", e)
    holon.id = id
    holon.name = sublense || id
    holon.description = 'Could not load data'
    holon.holons = []
  }

  return holon
}

async function fetchContributors(id) {
  var r = await fetch(id, {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      'Accept': 'application/vnd.github.v3+json'
    }
  })
  return r.json()
}

export async function fetchInfo(address, lense) {
  console.log('Requesting: ' + address)
  var type = 'N/A'
  var json = { id: address, url: address, name: 'n/a', image: 'notfound.jpg' }
  var base = ''
  var file = 'holon.json'
  var url = address
  var pathArray
  var fetchaddress

  // Empty address → show home
  if (address === '' || address === 'home' || address === undefined || address === null) {
    json = Home
    return { json, type: 'HOME' }
  }

  // Numeric ID (Telegram group etc) → HoloSphere holon
  if (address.match(/^-?[0-9]{5,}$/)) {
    type = 'HOLON'
    json = await fetchHolon(address, lense)
    return { json, type }
  }

  // Dotted holon address like "regenerativa.quests" or plain name like "regenerativa"
  if (address.match(/^[a-zA-Z][a-zA-Z0-9._-]*$/)) {
    type = 'HOLON'
    json = await fetchHolon(address, lense)
    return { json, type }
  }

  // GitHub
  if (address.includes('github.com')) {
    type = 'GITHUB'
    url = new URL(address)
    pathArray = url.pathname.split('/')
    base = 'https://raw.githubusercontent.com/' + pathArray[1] + '/' + pathArray[2] + '/master/'
    file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1)
    fetchaddress = base + file
  } else if (address.includes('githubusercontent')) {
    type = 'GITHUB CONTENT'
    fetchaddress = address
  } else if (address.includes('gitlab')) {
    type = 'GITLAB'
    url = new URL(address)
    pathArray = url.pathname.split('/')
    base = 'https://gitlab.com/' + pathArray[1] + '/' + pathArray[2] + '/-/raw/master/'
    file = url.pathname.slice(url.pathname.indexOf(pathArray[2]) + pathArray[2].length + 1)
    fetchaddress = base + file
  } else if (address.startsWith('http')) {
    type = 'WEB'
    fetchaddress = 'https://api.allorigins.win/get?url=' + address
  } else if (address.startsWith('0x')) {
    type = 'ETHEREUM'
    json = { id: address, name: address, description: 'Ethereum address' }
    return { json, type }
  } else {
    // Fallback: try as HoloSphere holon
    type = 'HOLON'
    json = await fetchHolon(address, lense)
    return { json, type }
  }

  if (!fetchaddress) return { json, type }
  if (fetchaddress.endsWith('/')) fetchaddress += 'holon.json'
  if (!fetchaddress.endsWith('.json')) fetchaddress += '.json'

  console.log('Fetching: ' + fetchaddress + ' - ' + type)

  var r = await fetch(fetchaddress)
  if (r.ok) {
    json = await r.json().catch(function() {
      console.log(fetchaddress + ' is not in a valid JSON format')
      return { json: json, type: type }
    })
    if (type === 'WEB' && json.contents && json.contents.startsWith('{')) {
      json = JSON.parse(json.contents)
    }
    json.url = fetchaddress
    return { json, type }
  } else {
    type = 'N/A'
    console.log(address + ' not found')
    return { json, type }
  }
}
