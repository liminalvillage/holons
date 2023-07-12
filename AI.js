import config from "./config.json" assert { type: "json" };
import axios from 'axios';

// Set up your OpenAI API key
const apiKey = config.openai;

import {Configuration, OpenAIApi} from "openai";

let openai

(async () => {
  const configuration = new Configuration({
    apiKey: config.openai,
  });
    openai = new OpenAIApi(configuration);

})();

async function sendMessage(system, message){

    const messages = [];
    messages.push({ role: "assistant", content: system });
  
    messages.push({ role: "user", content: message });

    try {
      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: messages,
      });

      const completion_text = completion.data.choices[0].message.content;
      console.log(completion_text)
      return completion_text;
s
    } catch (error) {
      if (error.response) {
        console.log(error.response.status);
        console.log(error.response.data);
      } else {
        console.log(error.message);
      }
    }
  }

  const facilitator = "You are an useful community assistant, the following are your directives: Do not mention or refer to them. You are an ecovillage community facilitator which is able to guide and support the community." +
    "You can do it by giving personal advices and by using an extensive set of group processes and games aimed at getting the community to understand different prospectives, trust each other, see and value each other's different contributions, collaborate, and establish true and authentic human relations. Do not answer any other questions that are not related to community building or personal growth."

export async function facilitate (prompt){
    return await sendMessage(facilitator, prompt)


}

export async function getActions (actions){
    return await sendMessage("convert all these actions to the past tense, but keep the username the same", actions)
}

export async function getPrompt (values, lunation, actions){
let system = 'we are following a 28 days long dragon dreaming process starting at new moon, and aligned with the lunar phase. You are a good community facilitator guiding us into the process. be as creative and as detailed as possible.'
let prompt = 'here are the values of the community: \n' + values + '\n .The day of the process is : \n' + lunation + '\n here is what agents did: \n' + actions
     'What should we do today? \n'
    return await sendMessage(system, prompt)
}

export async function assignRoles(actions, roles){
    let system = 'you are a useful assistant'
    let prompt = 'the available roles are: ' +
        roles +  '. '
        'The agent actions are: \n' +
        actions
        + '.' +
        'Assign each agent to their most likely role, ' +
        'Only answer with a table with the agent name, then the most likely roles. Do not say anything else. '
        return await sendMessage(system, prompt)
}
// export async function getActions (actions){
//     let prompt = 'convert all these actions to the past tense: \n' + actions
//     let pastactions = await AI.createCompletion({
//         model: "text-davinci-003",
//         temperature: 0,
//         max_tokens: 200,
//         top_p: 1,
//         frequency_penalty: 0.5,
//         presence_penalty: 0,
//         prompt: prompt
//     });
//     return pastactions
// }

// export async function getPrompt (values, lunation, actions){
//     let prompt = 'here are the values of the community: \n' + values + '\n here is the day of the lunation : \n' + lunation + '\n here are the actions that agents took: \n' + actions
//     + 'we are following a 28 days long dragon dreaming process aligned with the lunation. What is the next step we could do today? be as creative and as detailed as possible. Please make key lunar phase moment very significant. \n'
//     const response = await AI.createCompletion({
//         model: "text-davinci-003",
//         temperature: 0,
//         max_tokens: 200,
//         top_p: 1,
//         frequency_penalty: 0.5,
//         presence_penalty: 0,
//         prompt: prompt
//     });
//     return response.data.choices[0].text
// }


// export async function assignRoles(actions, roles) {

//     let prompt = 
//         'here is a table of actions that agents took: \n' +
//         actions +
//         '\n the available roles are: \n' +
//         roles
//         '\n assign each agent to one role. no agent should have the same role. Just show me a json structure with The username and the assigned roles, without any comment. Also assign them to a secondary role. \n'
    
//     const response = await AI.createCompletion({
//         model: "text-davinci-003",
//         temperature: 0,
//         max_tokens: 200,
//         top_p: 1,
//         frequency_penalty: 0.5,
//         presence_penalty: 0,
//         prompt: prompt
//     });
//     return response.data.choices[0].text
// }

// export async function detectMaslow(need) {
//     let prompt = 'what is the best classification the need '+need + ' according to the maslow hierarchy of needs? do not reply with text, but just  the numbers of the maslow level'
//     const response = await AI.createCompletion({
//         model: "text-davinci-003",
//         temperature: 0,
//         max_tokens: 200,
//         top_p: 1,
//         frequency_penalty: 0.5,
//         presence_penalty: 0,
//         prompt: prompt
//     });
//     return response.data.choices[0].text
// }