import { Configuration, OpenAIApi } from 'openai';

const configuration = new Configuration({
    apiKey: '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',
    model: 'davinci'
  });
  const AI = new OpenAIApi(configuration);

export async function assignRoles(actions, roles) {

    let prompt = 
        'here is a table of actions that agents took: \n' +
        'roberto: cook dinner, plant tree, clean pool, cook lunch, cook lunch, cook lunch \
        laura: play with elea, plant tree, plant tree, cook dinner \
        josh: play games, write articles, cook lunch \
        elisa: play with elea, learn java'+
        '\n the available roles are:'
        +'gardener, programmer, cook, caretaker' +
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