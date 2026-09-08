import React from 'react'
import { ROOM_RECTS, MEETING_CHAIRS } from '../systems/officeLayout'
import { t } from '../i18n'
import { Plant, Couch, RoundTable, CoffeeMachine, WaterCooler, Bookshelf, Printer, Whiteboard, WallWindow } from './TopDownFurniture'

// Original four-room architecture. All navigable room bounds use the movement contract.
export default function WhiteOfficeScene({ hour, weather, reducedMotion, onCoffee, onWhiteboard, children }) {
  const floors = ['#F8F9FA', '#F5F3EE', '#F2F5F7', '#F6F5F0']
  return <g data-office-design="white-four-room">
    <rect width="800" height="560" fill="#EEF1F3" />
    {Object.entries(ROOM_RECTS).map(([id,r], i) => <rect key={id} x={r.x1} y={r.y1} width={r.x2-r.x1} height={r.y2-r.y1} fill={floors[i]} />)}
    <g stroke="#DFE4E6" strokeWidth="0.5" opacity="0.48">
      {[110,210,310,410].map(x => <line key={x} x1={x} y1={40} x2={x} y2={345} />)}
      <path d="M10 115H500 M10 230H500 M530 325H780 M530 465H780 M610 245V540 M710 245V540 M20 455H490" />
    </g>
    <g fill="#D8DEE3">
      <path d="M0 0H800V560H0Z M10 10V550H790V10Z" fillRule="evenodd" />
      <path d="M500 10H520V105H500Z M500 150H520V270H500Z M500 315H520V550H500Z M520 215H790V235H520Z M10 345H225V365H10Z M280 345H500V365H280Z" />
    </g>
    <g stroke="#FFF" strokeWidth="4" opacity="0.9">
      <path d="M0 2H800 M502 10V105 M502 150V270 M502 315V550 M520 217H790 M10 347H225 M280 347H500" />
    </g>
    <g stroke="#BFCBD1" strokeWidth="1" fill="none" opacity="0.6">
      <path d="M500 105H520 M500 150H520 M500 270H520 M500 315H520 M225 345V365 M280 345V365" />
    </g>
    <g fill="#53636F" fontFamily="sans-serif" fontWeight="600" letterSpacing="1.3">
      <text x="130" y="38" fontSize="13">OFFICE</text>
      <text x="655" y="38" textAnchor="middle" fontSize="10">PRESIDENT'S OFFICE</text>
      <text x="635" y="263" textAnchor="middle" fontSize="11">MEETING ROOM</text>
      <text x="30" y="386" fontSize="11">LOUNGE</text>
    </g>
    {[250,350,440].map(x => <WallWindow key={x} x={x} y={14} w={42} h={20} hour={hour} weather={weather} reducedMotion={reducedMotion} />)}
    <WallWindow x={585} y={50} w={140} h={20} hour={hour} weather={weather} reducedMotion={reducedMotion} />
    <rect x={36} y={52} width={68} height={20} rx={5} fill="#D8DEE3" />
    <rect x={36} y={50} width={68} height={18} rx={5} fill="#FFFFFF" stroke="#CFD7DC" />
    <text x={70} y={62} textAnchor="middle" fontSize="6" fill="#53636F">{t('office.gate', 'GATE')}</text>
    <Plant x={28} y={110} /><Plant x={475} y={325} /><Plant x={760} y={90} />
    <Couch x={710} y={165} width={56} />
    <rect x={565} y={321} width={188} height={137} rx={24} fill="#DCE4E7" opacity="0.6" />
    {MEETING_CHAIRS.map((p,i) => <g key={i}>
      <rect x={p.x-10} y={p.y-8} width={20} height={17} rx={5} fill="#A7B3BB" />
      <rect x={p.x-8} y={p.y-7} width={16} height={12} rx={4} fill="#DCE3E5" />
    </g>)}
    <rect x={610} y={358} width={100} height={60} rx={12} fill="#CCD6DB" />
    <rect x={610} y={355} width={100} height={60} rx={12} fill="#FFFFFF" stroke="#CCD6DB" />
    <rect x={642} y={379} width={36} height={10} rx={5} fill="#E4EAEB" />
    <Plant x={764} y={325} /><Plant x={762} y={518} />
    <g onClick={onWhiteboard} style={{cursor:'pointer'}} transform="translate(735,250) scale(0.57,0.55)">
      <Whiteboard x={0} y={0} w={70} h={42} />
    </g>
    <rect x={25} y={391} width={45} height={24} rx={4} fill="#D9CDBB" />
    <rect x={25} y={390} width={45} height={21} rx={4} fill="#FFF" stroke="#D8DEE3" />
    <g onClick={onCoffee} style={{cursor:'pointer'}}><CoffeeMachine x={30} y={388} /></g>
    <WaterCooler x={130} y={391} />
    <rect x={125} y={440} width={115} height={91} rx={22} fill="#E4E4DB" />
    <Couch x={140} y={442} width={80} />
    <RoundTable x={220} y={505} r={16} />
    <g transform="translate(380,390) scale(1,0.58)"><Bookshelf x={0} y={0} width={90} rows={2} /></g>
    <Printer x={340} y={394} />
    <Couch x={347} y={442} width={68} />
    <Plant x={478} y={533} /><Plant x={25} y={536} />
    <g fill="#FDFDFB" stroke="#CED7DC" strokeWidth="0.8">
      <rect x={25} y={470} width={30} height={25} rx={4} />
      <rect x={445} y={470} width={30} height={25} rx={4} />
      <rect x={266} y={466} width={48} height={28} rx={4} />
    </g>
    <g fill="#647682" fontSize="5" textAnchor="middle">
      <text x={40} y={483}>{t('behaviorLabels.eat-snack', 'Snack')}</text>
      <text x={460} y={483}>{t('office.phone', 'PHONE')}</text>
      <text x={290} y={482}>{t('office.restroom', 'WC')}</text>
    </g>
    {children}
  </g>
}
