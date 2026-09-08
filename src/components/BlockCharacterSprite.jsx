import React from 'react'

const CHAR_STYLES = {
  pm:      { hair: '#3a2a1a', hairStyle: 'neat',       clothes: '#378ADD', gender: 'male' },
  arch:    { hair: '#5a4a8a', hairStyle: 'beret',      clothes: '#7F77DD', gender: 'male' },
  dev:     { hair: '#2a5a3a', hairStyle: 'twin-tails', clothes: '#1D9E75', gender: 'female' },
  qa:      { hair: '#5a4a3a', hairStyle: 'neat',       clothes: '#BA7517', gender: 'male' },
  ops:     { hair: '#4a3a2a', hairStyle: 'hard-hat',   clothes: '#D85A30', gender: 'male' },
  res:     { hair: '#3a7a6a', hairStyle: 'long',       clothes: '#5DCAA5', gender: 'female' },
  gate:    { hair: '#2a1a1a', hairStyle: 'spiky',      clothes: '#E24B4A', gender: 'male' },
  planner:  { hair: '#3a2a1a', hairStyle: 'neat',       clothes: '#378ADD', gender: 'male' },
  worker:   { hair: '#2a5a3a', hairStyle: 'bangs',      clothes: '#1D9E75', gender: 'female' },
  checker:  { hair: '#5a4a3a', hairStyle: 'neat',       clothes: '#BA7517', gender: 'male' },
  designer: { hair: '#4a1a2a', hairStyle: 'long',       clothes: '#E8688A', gender: 'female' },
}

// Original cuboids, drawn locally without meshes or external artwork. Feet anchor at y=0.
function Block({ x, y, width, height, fill, depth = 2 }) {
  return <g>
    <rect x={x} y={y} width={width} height={height} fill={fill} />
    <path d={`M${x},${y} l${depth},-${depth} h${width} l-${depth},${depth} Z`} fill={fill} />
    <path d={`M${x},${y} l${depth},-${depth} h${width} l-${depth},${depth} Z`} fill="white" opacity="0.22" />
    <path d={`M${x + width},${y} l${depth},-${depth} v${height} l-${depth},${depth} Z`} fill={fill} />
    <path d={`M${x + width},${y} l${depth},-${depth} v${height} l-${depth},${depth} Z`} fill="#263542" opacity="0.2" />
  </g>
}

function Face({ expression }) {
  const sleepy = expression === 'sleepy' || expression === 'tired'
  return <g data-expression={expression} fill="#293442" stroke="#293442" strokeWidth="0.8" strokeLinecap="round">
    {expression === 'happy' ? <path d="M-6,-31 l1.4,-1.3 1.4,1.3 M2,-31 l1.4,-1.3 1.4,1.3" fill="none" />
      : sleepy ? <path d="M-6,-31 h3 M2,-31 h3" />
        : <><rect x={-5.5} y={-32} width={1.5} height={expression === 'surprised' ? 3 : 2} rx="0.5" stroke="none" />
          <rect x={2.5} y={-32} width={1.5} height={expression === 'confused' ? 1 : expression === 'surprised' ? 3 : 2} rx="0.5" stroke="none" /></>}
    {expression === 'focused' && <path d="M-6,-34 l3,1 M2,-33 l3,-1" fill="none" />}
    {expression === 'confused' && <path d="M-6,-35 l3,-0.5" fill="none" />}
    {expression === 'surprised' ? <ellipse cx={-0.5} cy={-27} rx={1.2} ry={1.6} stroke="none" />
      : <path d={sleepy ? 'M-2,-27 h3' : expression === 'confused' ? 'M-2,-26 l3,-1' : 'M-3,-27 Q-0.5,-24.5 2,-27'} fill="none" />}
  </g>
}

export const CharacterPixelSprite = React.memo(function CharacterPixelSprite({ charId = 'pm', expression = 'normal', isMoving = false, walkFrame = 0, facing = 'down' }) {
  const baseRole = charId.split('~').pop()
  const style = CHAR_STYLES[charId] || CHAR_STYLES[baseRole] || CHAR_STYLES.pm
  const stride = isMoving ? (walkFrame ? 1 : -1) : 0
  const back = facing === 'up'
  const longHair = style.hairStyle === 'long' || style.hairStyle === 'twin-tails'
  return <g data-character-style="original-block">
    <ellipse cx={0} cy={1} rx={12} ry={3} fill="#53636F" opacity="0.16" />
    <g transform={facing === 'left' ? 'scale(-1 1)' : undefined}>
      {longHair && <><Block x={-11} y={-37} width={4} height={17} fill={style.hair} />
        <Block x={7} y={-37} width={4} height={17} fill={style.hair} /></>}
      <g transform={`translate(0,${Math.min(0, stride * 2)})`}>
        <Block x={-8} y={-11} width={6} height={9} fill="#526170" />
        <Block x={-8.5} y={-3} width={7} height={3} fill="#344351" depth={1.5} />
      </g>
      <g transform={`translate(0,${Math.min(0, -stride * 2)})`}>
        <Block x={1} y={-11} width={6} height={9} fill="#526170" />
        <Block x={0.5} y={-3} width={7} height={3} fill="#344351" depth={1.5} />
      </g>
      <g transform={`rotate(${stride * 9},-10,-21)`}>
        <Block x={-14} y={-23} width={5} height={9} fill={style.clothes} depth={1} />
        <Block x={-14} y={-14} width={5} height={4} fill="#F5D5B7" depth={1} />
      </g>
      <g transform={`rotate(${-stride * 9},10,-21)`}>
        <Block x={9} y={-23} width={5} height={9} fill={style.clothes} depth={1} />
        <Block x={9} y={-14} width={5} height={4} fill="#F5D5B7" depth={1} />
      </g>
      <Block x={-8} y={-24} width={15} height={13} fill={style.clothes} />
      {!back && <><path d="M-5,-24 L-0.5,-20 L4,-24" fill="#F7FAFC" />
        <rect x={3} y={-19} width={3} height={4} rx="0.5" fill="white" opacity="0.85" />
        <path d="M-0.5,-20 v8" stroke="white" opacity="0.24" strokeWidth="0.6" /></>}
      <Block x={-9} y={-38} width={17} height={15} fill={back ? style.hair : '#F5D5B7'} />
      <Block x={-9} y={-40} width={17} height={4} fill={style.hair} />
      {!back && <><path d={style.hairStyle === 'bangs' ? 'M-9,-36 h17 v3 l-5,-2 -3,2 -4,-2 -5,3 Z' : 'M-9,-37 h14 l-6,3 -5,-1 -3,4 Z'} fill={style.hair} />
        <Face expression={expression} /></>}
      {style.hairStyle === 'hard-hat' && <><Block x={-9} y={-40} width={18} height={3} fill="#F1B744" />
        <Block x={-11} y={-37} width={22} height={2} fill="#D49A30" depth={1} />
        <path d="M0,-42 v5" stroke="#FFE1A0" strokeWidth="2" /></>}
      {style.hairStyle === 'beret' && <><Block x={-10} y={-40} width={19} height={3} fill="#74669D" />
        <rect x={2} y={-43} width={2} height={2} fill="#51476F" /></>}
      {style.hairStyle === 'spiky' && <path d="M-9,-39 l1,-4 5,3 3,-3 4,3 4,-3 1,5 Z" fill={style.hair} />}
    </g>
  </g>
})

