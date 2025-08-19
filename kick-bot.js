require('dotenv').config();

const { deploy } = require('./deploy-kick-commands');
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg'); // substitui sqlite3 pelo pg
const express = require('express');
const fetch = require('node-fetch'); // se não tiver instalado, rode npm install node-fetch@2
const app = express();
const PORT = process.env.PORT || 3000;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });


// Deploy do slash
(async () => {
  console.log('⏳ Iniciando deploy...');
  await deploy();
  console.log('✅ Deploy finalizado');

  await client.login(process.env.DISCORD_TOKEN);

  client.once('ready', async () => {
    console.log(`Kick Bot online como ${client.user.tag}`);
    await initDb();
    periodicCheck();
  });
})();

// Conexão com PostgreSQL via Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Criar tabela se não existir
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kick_streamers (
      name TEXT PRIMARY KEY
    )
  `);
}

// Express config
app.get('/', (req, res) => {
  res.send('Você não deveria estar vendo essa mensagem!');
});

app.listen(PORT, () => {
  console.log(`Servidor web rodando na porta ${PORT}`);
});

// Banco de dados — funções

function addStreamer(name) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query(
        "INSERT INTO kick_streamers (name) VALUES ($1) ON CONFLICT DO NOTHING",
        [name]
      );
      resolve(res.rowCount > 0);
    } catch (err) {
      reject(err);
    }
  });
}

function removeStreamer(name) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query(
        "DELETE FROM kick_streamers WHERE name = $1",
        [name]
      );
      resolve(res.rowCount > 0);
    } catch (err) {
      reject(err);
    }
  });
}

function listStreamers() {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query("SELECT name FROM kick_streamers");
      const names = res.rows.map(row => row.name);
      resolve(names);
    } catch (err) {
      reject(err);
    }
  });
}

// Live status (em memória) para evitar spam de notificações
let liveStatus = {};

// Função para checar se streamer está ao vivo (igual ao seu original)
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

// Notificação embed no Discord (igual seu código)
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

// Checagem periódica de lives (igual seu código)
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
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  setTimeout(periodicCheck, 5 * 60 * 1000);
}

// Comandos Slash (mantidos igual)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'ping') {
    await interaction.reply('Pong!');
  }

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

      await interaction.channel.send({ embeds: [embed] });
      await interaction.editReply('✅ Lista de lives enviada neste canal.');
    }
  }
});


// Login
client.login(process.env.DISCORD_TOKEN);
