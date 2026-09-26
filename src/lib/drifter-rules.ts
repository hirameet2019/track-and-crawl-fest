/**
 * The organizer's drifter wristband rules, in the three languages spoken at the
 * gate. One source for both screens, so the words a drifter confirms on their
 * link are the words the desk reads out - only the point of view changes.
 */

export type RuleLang = "EN" | "TAGALOG" | "中文";
export type RuleLine = [RuleLang, string];

/** "desk" speaks about the drifter; "drifter" speaks to them on their own link. */
export function drifterRules(allowance: number, price: string, voice: "desk" | "drifter"): RuleLine[][] {
  const you = voice === "drifter";
  return [
    [
      ["EN", "Everyone inside the drifter area must wear a wristband at all times. Anyone without one will be asked to leave."],
      ["TAGALOG", "Dapat laging naka-suot ng wristband ang lahat ng nasa loob ng drifter area. Sinumang walang suot ay palalabasin."],
      ["中文", "进入漂移区域的所有人员必须全程佩戴手环。未佩戴手环者将被请离现场。"],
    ],
    you
      ? [
          ["EN", "Red wristbands are for you and the people with you: family, friends, pit crew, spotter, manager and other team staff."],
          ["TAGALOG", "Ang pulang wristband ay para sa iyo at sa mga kasama mo: pamilya, kaibigan, pit crew, spotter, manager at iba pang team staff."],
          ["中文", "红色手环仅限您及随行人员：家人、朋友、维修人员、观察员、领队及其他团队工作人员。"],
        ]
      : [
          ["EN", "Red wristbands are for the drifter and the people with them: family, friends, pit crew, spotter, manager and other team staff."],
          ["TAGALOG", "Ang pulang wristband ay para sa drifter at sa mga kasama niya: pamilya, kaibigan, pit crew, spotter, manager at iba pang team staff."],
          ["中文", "红色手环仅限车手及其随行人员：家人、朋友、维修人员、观察员、领队及其他团队工作人员。"],
        ],
    you
      ? [
          ["EN", `${allowance} bands are free. Any beyond that cost ${price} each, paid at the registration desk.`],
          ["TAGALOG", `${allowance} ang libre. Ang lampas dito ay ${price} bawat isa, bayad sa registration desk.`],
          ["中文", `前 ${allowance} 条免费，超出部分每条 ${price}，于登记处缴付。`],
        ]
      : [
          ["EN", `${allowance} bands are free per drifter. Any beyond that cost ${price} each.`],
          ["TAGALOG", `${allowance} ang libre kada drifter. Ang lampas dito ay ${price} bawat isa.`],
          ["中文", `每位车手可免费领取 ${allowance} 条，超出部分每条 ${price}。`],
        ],
  ];
}

/** What the drifter agrees to, identical on the desk and on their link. */
export const DRIFTER_CONFIRMATION: RuleLine[] = [
  ["EN", "I hereby confirm that I have read and understood the rules above, and I accept responsibility for every person wearing these wristbands."],
  ["TAGALOG", "Kinukumpirma ko na nabasa at naintindihan ko ang mga patakaran sa itaas, at mananagot ako sa bawat taong may suot ng mga wristband na ito."],
  ["中文", "本人确认已阅读并理解以上规则，并对佩戴这些手环的所有人员负责。"],
];
