import { Configuration, OpenAIApi } from 'openai';

const configuration = new Configuration({
    apiKey: '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',
    model: 'gpt-3.5'
  });
  const AI = new OpenAIApi(configuration);


export async function appreciate (prompt){
    return 
}

export async function assignRoles(actions, roles) {

    let prompt = 
        'here is a table of actions that agents took: \n' +
        actions +
        '\n the available roles are: \n' +
        roles
        '\n assign each agent to one role. no agent should have the same role. Just show me a json structure with the assigned roles, without any comment. Also assign them to a secondary role. \n'
    
    const response = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return response.data.choices[0].text
}

export async function detectMaslow(need) {
    let prompt = 'what is the best classification the need '+need + ' according to the maslow hierarchy of needs? do not reply with text, but just  the numbers of the maslow level'
    const response = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return response.data.choices[0].text
}