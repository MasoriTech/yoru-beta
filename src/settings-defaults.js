// Configurações padrão do avatar (o painel e o arquivo de dados mandam por cima, via window.api.getSettings()).
// O renderer.js copia este objeto para o seu S e depois aplica as configurações salvas.

export const DEFAULT_SETTINGS = {
  rotation: 0, opacity: 1, visible: true,
  handFree: false, lookAtCamera: true, followCursor: true, followCursorHead: 0.6, breathing: true, blinking: true, lipSync: true, clickReact: true, aiEmotes: true,
  chibi2dScale: 1.12,      // tamanho do Yoru Chibi 2D na tela (0,65 a 1,5)
  avatarMode: '3d', avatarFile: 'default', item: 'none', itemScale: 1, itemHand: 'right',
  bubbleEnabled: false, typeAnimation: true, bubbleSeconds: 0,
  speakSkipCode: true, speakSkipActions: false, speakMaxChars: 0, voiceGapMs: 0, voicePronounce: '', voiceSink: '',
  voiceEnabled: false, voiceEngine: 'neural', neuralVoice: 'pt-BR-FranciscaNeural', voiceName: '', voiceRate: 1, voicePitch: 1, voiceVolume: 1,
  baseEmotion: 'neutral',
  emotesEnabled: true, emoteMin: 8, emoteMax: 25, emoteSpeed: 1,
  emoteList: [
    'wave', 'happy', 'nod', 'shake', 'surprised', 'stretch', 'dance', 'bow', 'spin', 'shy',
    'cheer', 'laugh', 'sad', 'angry', 'sleepy', 'think', 'jump', 'disco', 'robot', 'samba',
    'ballet', 'hiphop', 'clap', 'pose', 'salute', 'sit', 'chair', 'duck', 'bed', 'tent',
    'thumbs_up', 'heart', 'blow_kiss', 'point', 'shrug', 'facepalm'
  ],
  fpsActive: 60, fpsIdle: 24, batterySaver: true, fpsBattery: 30, awayMin: 0, fpsAway: 5, quality: 'medium', textureSize: 1024, springBones: true, hairSway: true, hairSwayAmount: 0.5, idleAmount: 1, chibi: 0, blinkRate: 1, speakGestures: true, speakGestureAmount: 1, emotionStrength: 1, renderRes: 0, antialias: 'auto',
};
