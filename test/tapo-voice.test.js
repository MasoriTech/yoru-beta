'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTapoVoiceCommand } = require('../src/tapo-voice');

function first(text, random = () => 0.5) {
  return parseTapoVoiceCommand(text, { random });
}

test('reconhece ligar e desligar a lâmpada', () => {
  assert.deepEqual(first('acenda a luz').actions[0], { action:'on', args:{} });
  assert.deepEqual(first('apague a lâmpada').actions[0], { action:'off', args:{} });
});

test('reconhece cores nomeadas e combina cor com brilho', () => {
  const red = first('deixe a luz vermelha com 35%');
  assert.deepEqual(red.actions[0], { action:'color', args:{ hue:0, saturation:100, brightness:35 } });
  const blue = first('coloque a luz azul');
  assert.equal(blue.actions[0].args.hue, 220);
  assert.equal(blue.actions[0].args.brightness, null);
});

test('reconhece cor aleatória de forma reproduzível nos testes', () => {
  const command = first('mude a cor para uma cor aleatória', () => 0.5);
  assert.equal(command.actions[0].action, 'color');
  assert.equal(command.actions[0].args.hue, 180);
  assert.equal(command.actions[0].args.saturation, 100);
});

test('reconhece branco frio, neutro e quente/amarelo', () => {
  assert.equal(first('luz branca fria').actions[0].args.colorTemp, 6500);
  assert.equal(first('branco neutro').actions[0].args.colorTemp, 4000);
  assert.equal(first('luz amarela').actions[0].args.colorTemp, 2700);
  assert.equal(first('temperatura 3500K').actions[0].args.colorTemp, 3500);
});

test('reconhece brilho absoluto e relativo', () => {
  assert.equal(first('coloque a luz em 50 por cento').actions[0].args.brightness, 50);
  assert.equal(first('deixe a luz mais forte').actions[0].action, 'brightness-step');
  assert.equal(first('menos brilho na lâmpada').actions[0].args.step, -15);
});

test('reconhece as cenas por voz', () => {
  assert.equal(first('modo cinema').actions[0].args.scene, 'movie');
  assert.equal(first('Yoru, coloque a lâmpada em modo gamer').actions[0].args.scene, 'gaming');
  assert.equal(first('ative a cena leitura').actions[0].args.scene, 'reading');
});

test('reconhece temporizadores e cancelamento', () => {
  assert.deepEqual(first('desligue a luz em 30 minutos'), { type:'timer', target:'off', delayMs:1800000, say:'Programei para desligar a lâmpada daqui a 30 minuto(s).' });
  assert.equal(first('acenda a lâmpada daqui a meia hora').delayMs, 1800000);
  assert.equal(first('cancele o timer da luz').type, 'cancel-timer');
  assert.equal(first('desligue a luz em 48 horas').type, 'error');
});

test('não interpreta frases sem relação com iluminação', () => {
  assert.equal(first('como está o tempo hoje?'), null);
  assert.equal(first('toque uma música aleatória'), null);
});

test('reconhece efeitos nativos Festa e Relax e comando para parar efeitos', () => {
  assert.deepEqual(first('ative o efeito festa').actions[0], { action:'effect', args:{ effect:'Party' } });
  assert.deepEqual(first('coloque a animação relax com 35%').actions[0], { action:'effect', args:{ effect:'Relax', brightness:35 } });
  assert.deepEqual(first('pare o efeito da lâmpada').actions[0], { action:'effect', args:{ effect:'Off' } });
});

test('reconhece presets, transições suaves e branco automático', () => {
  assert.deepEqual(first('ative o preset 4').actions[0], { action:'preset', args:{ preset:4 } });
  assert.deepEqual(first('desligue a luz suavemente em 8 segundos').actions[0], { action:'transition-off', args:{ seconds:8 } });
  assert.deepEqual(first('acenda gradualmente').actions[0], { action:'transition-on', args:{ seconds:3 } });
  assert.deepEqual(first('ative o branco automático Auto Match').actions[0], { action:'auto-white', args:{ mode:'match' } });
  assert.deepEqual(first('branco automático para compensar a iluminação').actions[0], { action:'auto-white', args:{ mode:'compensate' } });
});

test('consulta o estado atual por voz', () => {
  assert.equal(first('Yoru, como está a lâmpada?').type, 'query');
});

test('reconhece tons adicionais, pastel e saturação personalizada sem confundir brilho', () => {
  assert.equal(first('coloque a lâmpada turquesa').actions[0].args.hue, 175);
  assert.equal(first('luz rosa claro').actions[0].args.hue, 340);
  assert.deepEqual(first('azul pastel').actions[0].args, { hue:220, saturation:35, brightness:null });
  assert.deepEqual(first('verde com saturação 45% e brilho 70%').actions[0].args, { hue:120, saturation:45, brightness:70 });
});

test('explica quais funções do aplicativo ainda não são controláveis pela API local', () => {
  assert.equal(first('Yoru, ative o modo ausente').type, 'unsupported');
  assert.equal(first('Yoru, agende a lâmpada para ligar todo dia').type, 'unsupported');
  assert.equal(first('Yoru, quanto a lâmpada consumiu de energia?').type, 'unsupported');
});

test('aceita temperatura Kelvin com o número antes da unidade', () => {
  assert.deepEqual(first('coloque a luz em 3200 kelvin').actions[0], { action:'temperature', args:{ colorTemp:3200 } });
  assert.deepEqual(first('quero 5000K na lâmpada').actions[0], { action:'temperature', args:{ colorTemp:5000 } });
});

test('distingue luz amarela quente de cor amarela saturada', () => {
  assert.deepEqual(first('luz amarela').actions[0], { action:'temperature', args:{ colorTemp:2700 } });
  assert.deepEqual(first('cor amarela').actions[0], { action:'color', args:{ hue:58, saturation:100, brightness:null } });
});

test('"desliga a luz", "apaga a luz" e "liga a luz" funcionam na forma curta', () => {
  assert.deepEqual(first('desliga a luz').actions[0], { action:'off', args:{} });
  assert.deepEqual(first('apaga a luz').actions[0], { action:'off', args:{} });
  assert.deepEqual(first('liga a luz').actions[0], { action:'on', args:{} });
  assert.equal(first('desliga a luz daqui a 5 minutos').type, 'timer');
});

test('"estou com sono" e "vou dormir" apagam a luz mesmo sem dizer "luz"', () => {
  for (const frase of ['estou com sono', 'tô com sono', 'vou dormir', 'vou dormir agora', 'já vou deitar', 'hora de dormir']) {
    const c = first(frase);
    assert.equal(c.type, 'actions', frase);
    assert.deepEqual(c.actions, [{ action:'off', args:{} }], frase);
    assert.equal(c.soft, true, frase);
  }
});

test('frases sobre sono que não são pedido não mexem na luz', () => {
  for (const frase of ['vou dormir?', 'não vou dormir', 'você está com sono', 'boa noite', 'como dormir melhor', 'estou com sono, acende a luz']) {
    const c = first(frase);
    assert.ok(!c || !c.actions || !c.actions.some(a => a.action === 'off'), frase);
  }
  assert.equal(first('estou com sono apaga a luz em 10 minutos').type, 'timer');
});

test('só explica o que sabe fazer quando a pessoa pede', () => {
  for (const frase of ['me ensina sobre a lâmpada', 'o que você sabe fazer com a lâmpada', 'quais comandos da lâmpada', 'como funciona a luz']) {
    const c = first(frase);
    assert.equal(c.type, 'help', frase);
    assert.match(c.say, /apaga a luz/);
    assert.match(c.say, /vou dormir/);
  }
  assert.equal(first('lâmpada'), null);
  assert.equal(first('a luz está legal hoje'), null);
});

test('"apague/desligue a lâmpada", "modo festa" e "modo relax" funcionam, e dá para sair do modo', () => {
  assert.deepEqual(first('apague a lâmpada').actions[0], { action:'off', args:{} });
  assert.deepEqual(first('desligue a lâmpada').actions[0], { action:'off', args:{} });
  const festa = first('modo festa');
  assert.deepEqual(festa.actions[0], { action:'scene', args:{ scene:'party' } });
  assert.match(festa.say, /modo festa/);
  assert.deepEqual(first('coloca a lâmpada no modo relax').actions[0], { action:'scene', args:{ scene:'relax' } });
  for (const frase of ['sai do modo festa', 'desativa o modo relax', 'desliga o modo festa']) {
    assert.deepEqual(first(frase).actions[0], { action:'effect', args:{ effect:'Off' } }, frase);
  }
  assert.match(first('o que você sabe fazer com a lâmpada').say, /modo festa.*modo relax/);
});
