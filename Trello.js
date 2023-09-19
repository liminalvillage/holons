import {Telegraf } from 'telegraf';
import  fetch  from 'node-fetch';

import config from "./config.json" assert { type: "json" };

const TRELLO_API_KEY = 'ATATT3xFfGF00WnH6JaK9NJuLlAkEwGNuxd_v2cmdx5d_FcNbqB0SuPKfFi30QSP6zvJvAnLrd6ryvuVIAqm3jNaa5zZEF5WEv0cguCIesWUqi_yk8KwQ3yVWAEUqvHLFF7ojE-7lSIQBAEVuataGutDBdMuiRefnEIk0SVxHQn50yYY3PYJvRU=D7819D2A';
const TRELLO_TOKEN = 'ATTA8aac49df5ad31d45392e75ac0cd6b65c1cdf5aa177c5fd55a53cae60fb0acc17DC6307AA';
const BOARD_ID = 'YOUR_BOARD_ID';

class Trello {

    constructor(bot) {
            // Function to create a new card on Trello
            const createCard = async (listId, name) => {
            const response = await fetch(`https://api.trello.com/1/cards?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&idList=${listId}&name=${name}`, {
                method: 'POST'
            });
            return await response.json();
            };

            // Function to move a card on Trello
            const moveCard = async (cardId, targetListId) => {
            const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&idList=${targetListId}`, {
                method: 'PUT'
            });
            return await response.json();
            };

            // Function to edit a card name on Trello
            const editCard = async (cardId, newName) => {
            const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}&name=${newName}`, {
                method: 'PUT'
            });
            return await response.json();
            };

            // Telegraf command to create a new card
            bot.command('createcard', async (ctx) => {
            const listId = 'YOUR_LIST_ID';
            const name = ctx.message.text.split(' ').slice(1).join(' ');
            const card = await createCard(listId, name);
            ctx.reply(`Card created: ${card.name}`);
            });

            // Telegraf command to move a card
            bot.command('movecard', async (ctx) => {
            const cardId = 'YOUR_CARD_ID';
            const targetListId = 'YOUR_TARGET_LIST_ID';
            const card = await moveCard(cardId, targetListId);
            ctx.reply(`Card moved: ${card.name}`);
            });

            // Telegraf command to edit a card
            bot.command('editcard', async (ctx) => {
            const cardId = 'YOUR_CARD_ID';
            const newName = ctx.message.text.split(' ').slice(1).join(' ');
            const card = await editCard(cardId, newName);
            ctx.reply(`Card updated: ${card.name}`);
            });
    }
}

export default Trello