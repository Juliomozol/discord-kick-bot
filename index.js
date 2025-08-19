require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// Polyfill para fetch se necessário
if (!globalThis.fetch) {
  globalThis.fetch = require('node-fetch');
}
const db = new sqlite3.Database('./streamers.db');

// Cria a tabela se não existir
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS streamers (name TEXT UNIQUE)");
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Live status (em memória) para evitar spam de notificações
let liveStatus = {};

// 🔹 Funções de banco de dados

function addStreamer(name) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare("INSERT OR IGNORE INTO streamers (name) VALUES (?)");
    stmt.run(name, function (err) {
      if (err) reject(err);
      resolve(this.changes > 0); // true se foi adicionado
    });
    stmt.finalize();
  });
}

function removeStreamer(name) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare("DELETE FROM streamers WHERE name = ?");
    stmt.run(name, function (err) {
      if (err) reject(err);
      resolve(this.changes > 0); // true se foi removido
    });
    stmt.finalize();
  });
}

function listStreamers() {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM streamers", [], (err, rows) => {
      if (err) reject(err);
      const names = rows.map(row => row.name);
      resolve(names);
    });
  });
}

// 🔹 Checar se streamer está ao vivo
async function checkLive(streamer) {
  const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
  const tokenData = await tokenResponse.json();

  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${streamer}`, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${tokenData.access_token}`
    }
  });
  const data = await res.json();
  return data.data && data.data.length > 0;
}

// 🔹 Enviar notificação para o Discord com embed
async function notifyLive(streamer) {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  
  // Buscar informações da live
  const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
  const tokenData = await tokenResponse.json();

  const streamRes = await fetch(`https://api.twitch.tv/helix/streams?user_login=${streamer}`, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${tokenData.access_token}`
    }
  });
  const streamData = await streamRes.json();

  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${streamer}`, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${tokenData.access_token}`
    }
  });
  const userData = await userRes.json();

  if (streamData.data && streamData.data.length > 0 && userData.data && userData.data.length > 0) {
    const stream = streamData.data[0];
    const user = userData.data[0];
    
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle(`${user.display_name} está online!`)
      .setDescription(`**${stream.title}**`)
      .addFields(
        { name: 'Jogo', value: stream.game_name || 'N/A', inline: true },
        { name: 'Viewers', value: stream.viewer_count.toString(), inline: true }
      )
      .setThumbnail(user.profile_image_url)
      .setImage(stream.thumbnail_url.replace('{width}', '480').replace('{height}', '270'))
      .setURL(`https://twitch.tv/${streamer}`)
      .setTimestamp();

    channel.send({ content: `🔴 **${user.display_name}** is now live on Twitch!`, embeds: [embed] });
  } else {
    channel.send(`🔴 **${streamer}** está ao vivo na Twitch! Assista agora: https://twitch.tv/${streamer}`);
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
  }
  setTimeout(periodicCheck, 5 * 60 * 1000); // a cada 5 minutos
}

// 🔹 Comandos Slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  try {
    if (commandName === 'add') {
      await interaction.deferReply();
      const streamer = interaction.options.getString('nome');
      const added = await addStreamer(streamer);
      if (added) {
        await interaction.editReply(`✅ Streamer **${streamer}** adicionado!`);
      } else {
        await interaction.editReply(`⚠️ Streamer **${streamer}** já está na lista.`);
      }
    }

  if (commandName === 'remove') {
      await interaction.deferReply();
      const streamer = interaction.options.getString('nome');
      const removed = await removeStreamer(streamer);
      if (removed) {
        liveStatus[streamer] = false;
        await interaction.editReply(`🗑 Streamer **${streamer}** removido da lista!`);
      } else {
        await interaction.editReply(`⚠️ Streamer **${streamer}** não estava na lista.`);
      }
    }

    if (commandName === 'list') {
      await interaction.deferReply();
      const streamers = await listStreamers();
      await interaction.editReply(`🎮 Streamers na lista: ${streamers.join(', ') || 'Nenhum'}`);
    }

    if (commandName === 'check') {
      await interaction.deferReply();
      const streamers = await listStreamers();
      const liveStreamers = [];

      for (const streamer of streamers) {
        try {
          const isLive = await checkLive(streamer);
          if (isLive) {
            liveStreamers.push(`🔴 [${streamer}](https://twitch.tv/${streamer})`);
          }
        } catch (error) {
          console.error(`Erro ao verificar ${streamer}:`, error);
        }
      }

      if (liveStreamers.length > 0) {
        await interaction.editReply(`**Streamers online agora:**\n${liveStreamers.join('\n')}`);
      } else {
        await interaction.editReply('📴 Nenhum streamer está online no momento.');
      }
    }
  } catch (error) {
    console.error('Erro na interação:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Ocorreu um erro ao processar o comando.', ephemeral: true });
    } else {
      await interaction.editReply('❌ Ocorreu um erro ao processar o comando.');
    }
  }
});

// 🔹 Quando o bot estiver pronto
client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
  periodicCheck(); // inicia a verificação de lives
});

client.login(process.env.DISCORD_TOKEN);
