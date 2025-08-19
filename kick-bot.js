require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./kick-streamers.db');

const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

app.get('/', (req, res) => {
  res.send('Você não deveria estar vendo essa mensagem!');
});

app.listen(PORT, () => {
  console.log(`Servidor web rodando na porta ${PORT}`);
});

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

// Aqui você adiciona os seus eventos e comandos, ex:

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});

// Login do bot
client.login(process.env.DISCORD_TOKEN);


// Cria a tabela se não existir
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS kick_streamers (name TEXT UNIQUE)");
});

client.commands = new Collection();

// Live status (em memória) para evitar spam de notificações
let liveStatus = {};

// 🔹 Funções de banco de dados

function addStreamer(name) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare("INSERT OR IGNORE INTO kick_streamers (name) VALUES (?)");
    stmt.run(name, function (err) {
      if (err) reject(err);
      resolve(this.changes > 0); // true se foi adicionado
    });
    stmt.finalize();
  });
}

function removeStreamer(name) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare("DELETE FROM kick_streamers WHERE name = ?");
    stmt.run(name, function (err) {
      if (err) reject(err);
      resolve(this.changes > 0); // true se foi removido
    });
    stmt.finalize();
  });
}

function listStreamers() {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM kick_streamers", [], (err, rows) => {
      if (err) reject(err);
      const names = rows.map(row => row.name);
      resolve(names);
    });
  });
}

// 🔹 Checar se streamer está ao vivo na Kick
async function checkLive(streamer) {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${streamer}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!res.ok) {
      console.log(`Streamer ${streamer} não encontrado na Kick`);
      return false;
    }
    
    const data = await res.json();
    return data.livestream !== null && data.livestream !== undefined;
  } catch (error) {
    console.error(`Erro ao verificar ${streamer}:`, error.message);
    return false;
  }
}

// 🔹 Enviar notificação para o Discord com embed
async function notifyLive(streamer) {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${streamer}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      
      if (data.livestream) {
        const { EmbedBuilder } = require('discord.js');
        
        // Extrair URL da thumbnail corretamente
        let thumbnailUrl = null;
        if (data.livestream.thumbnail) {
          if (typeof data.livestream.thumbnail === 'string') {
            thumbnailUrl = data.livestream.thumbnail.replace(/&width=\d+/, '&width=854').replace(/&height=\d+/, '&height=480');
          } else if (data.livestream.thumbnail.url) {
            thumbnailUrl = data.livestream.thumbnail.url.replace(/&width=\d+/, '&width=854').replace(/&height=\d+/, '&height=480');
          }
        }
        
        // Obter categoria/jogo
        const categoria = data.livestream.categories?.[0]?.name || 
                         data.livestream.category?.name || 
                         data.category?.name || 
                         'Just Chatting';
        
        const embed = new EmbedBuilder()
          .setColor('#53FC18')
          .setTitle(`${data.user.username} is now live on Kick!`)
          .setDescription(`**${data.livestream.session_title || 'Live sem título'}**\n\nPlaying ${categoria}`)
          .addFields(
            { name: 'Viewers', value: data.livestream.viewer_count?.toString() || '0', inline: true }
          )
          .setThumbnail(data.user.profile_pic || null)
          .setImage(thumbnailUrl)
          .setURL(`https://kick.com/${streamer}`)
          .setTimestamp();

        channel.send({ content: `🟢 **${data.user.username}** is now live on Kick!`, embeds: [embed] });
      } else {
        channel.send(`🟢 **${streamer}** está ao vivo na Kick! Assista agora: https://kick.com/${streamer}`);
      }
    } else {
      channel.send(`🟢 **${streamer}** está ao vivo na Kick! Assista agora: https://kick.com/${streamer}`);
    }
  } catch (error) {
    console.error(`Erro ao buscar dados do streamer ${streamer}:`, error);
    channel.send(`🟢 **${streamer}** está ao vivo na Kick! Assista agora: https://kick.com/${streamer}`);
  }
}

// 🔹 Checagem periódica de lives
async function periodicCheck() {
  const streamers = await listStreamers();
  for (const streamer of streamers) {
    const isLive = await checkLive(streamer);
    if (isLive && !liveStatus[streamer]) {
      await notifyLive(streamer);
      liveStatus[streamer] = true;
    } else if (!isLive) {
      liveStatus[streamer] = false;
    }
    // Delay entre requests para não sobrecarregar a API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  setTimeout(periodicCheck, 5 * 60 * 1000); // a cada 5 minutos
}

// 🔹 Comandos Slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'kickadd') {
    await interaction.deferReply();
    const streamer = interaction.options.getString('nome');
    const added = await addStreamer(streamer);
    if (added) {
      await interaction.editReply(`✅ Streamer **${streamer}** adicionado à lista da Kick!`);
    } else {
      await interaction.editReply(`⚠️ Streamer **${streamer}** já está na lista da Kick.`);
    }
  }

  if (commandName === 'kickremove') {
    await interaction.deferReply();
    const streamer = interaction.options.getString('nome');
    const removed = await removeStreamer(streamer);
    if (removed) {
      liveStatus[streamer] = false;
      await interaction.editReply(`🗑 Streamer **${streamer}** removido da lista da Kick!`);
    } else {
      await interaction.editReply(`⚠️ Streamer **${streamer}** não estava na lista da Kick.`);
    }
  }

  if (commandName === 'kicklist') {
    await interaction.deferReply();
    const streamers = await listStreamers();
    await interaction.editReply(`🎮 Streamers da Kick na lista: ${streamers.join(', ') || 'Nenhum'}`);
  }

  if (commandName === 'kickcheck') {
    await interaction.deferReply();
    const streamerName = interaction.options.getString('nome');
    
    try {
      const isLive = await checkLive(streamerName);
      
      if (isLive) {
        const res = await fetch(`https://kick.com/api/v2/channels/${streamerName}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.livestream) {
            const categoria = data.livestream.categories?.[0]?.name || 
                           data.livestream.category?.name || 
                           data.category?.name || 
                           'Just Chatting';
            const titulo = data.livestream.session_title || 'Live sem título';
            const viewers = data.livestream.viewer_count || 0;
            
            await interaction.editReply(`🟢 **[${data.user.username}]https://kick.com/${streamerName} está ONLINE!\n\n**${titulo}**\nPlaying ${categoria}\nViewers: ${viewers}`);
          } else {
            await interaction.editReply(`🟢 **${streamerName}** está online na Kick!\nhttps://kick.com/${streamerName}`);
          }
        } else {
          await interaction.editReply(`❌ Streamer **${streamerName}** não foi encontrado na Kick.`);
        }
      } else {
        await interaction.editReply(`📴 **${streamerName}** está OFFLINE no momento.`);
      }
    } catch (error) {
      console.error(`Erro ao verificar ${streamerName}:`, error);
      await interaction.editReply(`❌ Erro ao verificar o streamer **${streamerName}**. Tente novamente.`);
    }
  }
  if (commandName === 'live') {
    await interaction.deferReply({ flags: 1 << 6 });


    const streamers = await listStreamers();
    const liveStreamers = [];

    for (const streamer of streamers) {
      const isLive = await checkLive(streamer);
      if (isLive) {
        liveStreamers.push(streamer);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (liveStreamers.length === 0) {
      await interaction.editReply('📴 Nenhum streamer está ao vivo no momento.');
    } else {
      const embed = {
        color: 0x53FC18,
        title: '🟢 Streamers ao vivo agora na Kick!',
        description: liveStreamers.map(name => `🔗 [${name}](https://kick.com/${name})`).join('\n'),
        timestamp: new Date().toISOString()
      };

      // Envia o embed no canal onde o comando foi usado
      await interaction.channel.send({ embeds: [embed] });

      // Responde ao usuário que a lista foi enviada
      await interaction.editReply('✅ Lista de lives enviada neste canal.');
    }
  }
});

// 🔹 Quando o bot estiver pronto
client.once('ready', () => {
  console.log(`Kick Bot online como ${client.user.tag}`);
  periodicCheck(); // inicia a verificação de lives
});

