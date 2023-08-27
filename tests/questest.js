describe('test WeQuestBot', function() {
    it('test WeQuestBot.Quests.quest', function(done) {
        let ctx = {
            message: {
                chat: {
                    id: 1234
                },
                message_id: 1234,
                from: {
                    id: 1234
                },
                text: '/quest test'
            }
        }
        let orbitdb = {
            docs: function() {
                return {
                    load: function() {
                        return true;
                    },
                    put: function() {
                        return true;
                    }
                }
            }
        }
        let controller = {
            settings: {
                getLanguage: function() {
                    return 'es'
                }
            }
        }
        let bot = new WeQuestBot.Quests(controller)
        bot.quest('offer', ctx, orbitdb).then(function(result) {
            assert.equal(result, true);
            done();
        })
    })
})