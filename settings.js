import i18next from "i18next";
import fs from 'fs';
import locales from "./locales.json" assert { type: "json" };
import exp from "constants";


let settingsDB 

function getDefaultSettings(chatID) {
    return {
      _id: chatID,
      language: 'en',
      theme: 'dark',
      level: 0,
      admin: '',
      roles: ''
    }
} 

export async function init (orbitdb){
i18next
  .init({
    lng: 'en',
    resources: locales,
    fallbackLng: 'en',
  });


 settingsDB = await orbitdb.docs('WeQuest.settings')
 settingsDB.load()
}

// get language from the database
export async function getLanguage(chatID) {

    let settings = await settingsDB.get(chatID)[0]
 
    return settings? settings.language : 'en'
}

export async function setLanguage(ctx) {
    const chatID = ctx.message.chat.id;
    const language = ctx.message.text.split(' ')[1];
    let settings = await settingsDB.get(chatID)[0]
    if (language === undefined || language === null) {
            ctx.reply('Please specify the language. Example: /setLanguage en')
            return
          }
          if ( language !== 'en' && language !== 'it') {
            ctx.reply('Please specify "it" or "en". Example: /setLanguage en')
            return
          }
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
    }
    settings.language = language
    settingsDB.put(settings)
    ctx.reply('Language changed to ' + language)
}

export async function getTheme(chatID) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') { 
        settings =  getDefaultSettings(chatID)
        settingsDB.put(settings)
    }

    if (settings.theme === 'light') {
          //return themelight
          return fs.readFileSync('theme-light.css', 'utf8');
    } else {
        //return themedark
          return fs.readFileSync('theme-dark.css',  'utf8');
    }
}


export async function setTheme(ctx) {
    const chatID = ctx.message.chat.id; 
    const theme = ctx.message.text.split(' ')[1];
    let settings = await settingsDB.get(chatID)[0]
    if (theme === undefined || theme === null) {
            ctx.reply('Please specify the theme. Example: /setTheme light')
            return
          }
          if ( theme !== 'light' && theme !== 'dark') {
            ctx.reply('Please specify "light" or "dark". Example: /setTheme light')
            return
          }
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
    }
    settings.theme = theme
    settingsDB.put(settings)
    ctx.reply('Theme changed to ' + theme)
}

export async function getLevel(chatID) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') { 
        settings =  getDefaultSettings(chatID)
        settingsDB.put(settings)
    }
    return settings.level
}

export async function setLevel(ctx) {
    const chatID = ctx.message.chat.id;
    const level = ctx.message.text.split(' ')[1];
    let settings = await settingsDB.get(chatID)[0]
    if (level === undefined || level === null) {
            ctx.reply('Please specify the level. Example: /setLevel 1')
            return
          }
          if ( level !== '1' && level !== '2' && level !== '3') {
            ctx.reply('Please specify "1", "2" or "3". Example: /setLevel 1')
            return
          }
    if (!settings || settings == '') {

        settings =  getDefaultSettings(chatID)
    }
    settings.level = level
    settingsDB.put(settings)
    ctx.reply('Level changed to ' + level)

}

export async function getAdmin(chatID) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
        settingsDB.put(settings)
    }
    return settings.admin
}

export async function setAdmin(ctx) {
    const chatID = ctx.message.chat.id;
    const admin = ctx.message.text.split(' ')[1];
    let settings = await settingsDB.get(chatID)[0]
    if (admin === undefined || admin === null) {
            ctx.reply('Please specify the admin. Example: /setAdmin @admin')
            return
          }
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
    }
    settings.admin = admin
    settingsDB.put(settings)
    ctx.reply('Admin changed to ' + admin)
}

 export async function setRoles(chatID, roles) {
    let settings = await settingsDB.get(chatID)[0]
    if (roles === undefined || roles === null) {
        console.log('Please specify the roles. Example: /setRoles role1 role2')
        return
    }
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
    }
    settings.roles = roles
    settingsDB.put(settings)
    return settings.roles
}

export async function getRoles(chatID) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
        settingsDB.put(settings)
    }
    return settings.roles
}

export async function getSettings(chatID) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
        settingsDB.put(settings)
    }
    return settings
}

export async function setSettings(chatID, settings) {
    settingsDB.put(settings)
}

export async function setValueEquation(chatID, valueEquation) {
    let settings = await settingsDB.get(chatID)[0]
    if (!settings || settings == '') {
        settings =  getDefaultSettings(chatID)
    }
    settings.valueEquation = valueEquation
    settingsDB.put(settings)
}

// export async function getSettingsButtons(chatID) {
//     return [
//         [{ text: 'Language:'}], [{ text: 'IT', setLanguage(chatID, 'it') }],[{ text: 'EN', setLanguage(ctx, 'en') }]
//         [{ text: 'Theme' }],
//         [{ text: 'Level', callback_data: 'level' }],
//         [{ text: 'Admin', callback_data: 'admin' }],
//         [{ text: 'Roles', callback_data: 'roles' }]
//     ]
// }