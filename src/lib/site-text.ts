/**
 * Every fixed piece of wording on the public pages, editable in Admin > Settings >
 * Website text. Settings store only what an admin changed (rules.text): a missing
 * key shows the default below, so improved defaults still reach untouched texts,
 * and an empty string hides an optional line.
 *
 * Wording may use {placeholders} (listed per text, filled by the page) and two bits
 * of markup: **bold** and [a link](/path). Plain data with no server imports: the
 * settings form, server pages and client components all read it.
 */

export type TextGroup =
  | "Event details"
  | "Circuit map key"
  | "Ticket choices"
  | "Ticket holders"
  | "Shirt delivery"
  | "Shirt size chart"
  | "Review before paying"
  | "Payment page"
  | "Order status page"
  | "Single ticket page"
  | "Help box"
  | "Staff login and missing page"
  | "Search and sharing";

export interface TextDef {
  group: TextGroup;
  /** What the text is, for the admin. */
  label: string;
  text: string;
  /** Placeholders the page fills in, with what each becomes. */
  vars?: Record<string, string>;
  /** Shown as a paragraph box rather than one line. */
  long?: boolean;
  /** May be hidden: an empty value removes it from the page. */
  optional?: boolean;
}

const REG = { reg: "registration (Terms)", Reg: "Registration", regs: "registrations", Regs: "Registrations" };

export const SITE_TEXT = {
  /* ------------------------------------------------------- event details */
  "hero.timeOnwards": { group: "Event details", label: "Hero: start time after the date", text: "{time} onwards", vars: { time: "start time, e.g. 7:00 AM" } },
  "hero.dateTba": { group: "Event details", label: "Hero: no date set yet", text: "Date TBA" },
  "hero.pricePer": { group: "Event details", label: "Hero: price label for a vehicle", text: "per {noun}", vars: { noun: "car or motorcycle" } },
  "hero.scrollCue": { group: "Event details", label: "Hero: scroll arrow", text: "Scroll" },
  "info.venue": { group: "Event details", label: "Venue heading", text: "Venue" },
  "info.mapsLink": { group: "Event details", label: "Map link under the venue", text: "Open in Google Maps" },
  "info.date": { group: "Event details", label: "Date heading", text: "Event date" },
  "info.dateTba": { group: "Event details", label: "No date set yet", text: "Date to be announced" },
  "info.time": { group: "Event details", label: "Time heading", text: "Time" },
  "info.presentedBy": { group: "Event details", label: "Above the presenter logos", text: "Presented by" },
  "home.salesEnded": { group: "Event details", label: "Registration closed: before the closed text", text: "Online sales ended {date}.", vars: { date: "when the last online sale closed" } },
  "home.staffLink": { group: "Event details", label: "Footer staff link", text: "Staff login" },
  "home.noEventTitle": { group: "Event details", label: "No event on sale: heading", text: "No event is on sale right now." },
  "home.noEventText": { group: "Event details", label: "No event on sale: text", text: "Registration opens soon. Please check back later.", optional: true },

  /* ------------------------------------------------------- circuit map key */
  "circuit.keyCurbs": { group: "Circuit map key", label: "Curbs", text: "Curbs", optional: true },
  "circuit.keyStart": { group: "Circuit map key", label: "Start / finish line", text: "Start / finish", optional: true },
  "circuit.keyDirection": { group: "Circuit map key", label: "Direction arrows", text: "Direction", optional: true },
  "circuit.keyBuildings": { group: "Circuit map key", label: "Buildings", text: "Buildings", optional: true },
  "circuit.keyParking": { group: "Circuit map key", label: "Parking (hidden until you type a name)", text: "", optional: true },
  "circuit.keyZones": { group: "Circuit map key", label: "Zones such as the pit lane (hidden until you type a name)", text: "", optional: true },

  /* ------------------------------------------------------- ticket choices */
  "form.tagShirt": { group: "Ticket choices", label: "Tag: includes a shirt", text: "Event t-shirt" },
  "form.shirtProcessing": { group: "Ticket choices", label: "How long a shipped shirt takes", text: "about two weeks" },
  "form.tagShips": { group: "Ticket choices", label: "Tag: shirt ships", text: "Ships to you in {time}", vars: { time: "how long a shipped shirt takes" } },
  "form.tagVehicle": { group: "Ticket choices", label: "Tag: vehicle details needed", text: "Photo, plate and model of the {noun} needed", vars: { noun: "car or motorcycle" } },
  "form.sizeChart": { group: "Ticket choices", label: "Size chart link", text: "Size chart" },
  "form.salesClosed": { group: "Ticket choices", label: "Online sales closed", text: "Online sales closed {date}", vars: { date: "closing date" } },
  "form.soldOut": { group: "Ticket choices", label: "Sold out", text: "Sold out" },
  "form.onlyLeft": { group: "Ticket choices", label: "Few left", text: "Only {n} left", vars: { n: "how many are left" } },
  "form.salesUntil": { group: "Ticket choices", label: "Online sales until", text: "Online sales until {date}", vars: { date: "closing date and time" } },
  "form.companionsIncluded": {
    group: "Ticket choices", label: "Vehicle with included passengers", long: true,
    text: "Includes a {reg} for **{passengers}**. Bringing more people? Add companions inside this ticket at {price} each, each a {companion} with event t-shirt.",
    vars: { ...REG, passengers: "e.g. 1 passenger", price: "companion price", companion: "companion ticket name" },
  },
  "form.companionsPaid": {
    group: "Ticket choices", label: "Vehicle without included passengers", long: true,
    text: "Bringing passengers? Add companions inside this ticket, {price} each: a {companion} {reg} with event t-shirt, linked to your car.",
    vars: { ...REG, price: "companion price", companion: "companion ticket name" },
  },

  /* ------------------------------------------------------- ticket holders */
  "form.ticketNo": { group: "Ticket holders", label: "Each ticket's heading", text: "Ticket {n}", vars: { ...REG, n: "1, 2, 3 ..." } },
  "form.holderName": { group: "Ticket holders", label: "Name label", text: "Holder full name" },
  "form.holderNamePlaceholder": { group: "Ticket holders", label: "Name placeholder", text: "Name of the person using this ticket", optional: true },
  "form.driverName": { group: "Ticket holders", label: "Name label for a vehicle", text: "{Person} full name", vars: { Person: "Driver or Rider", person: "driver or rider" } },
  "form.driverNamePlaceholder": { group: "Ticket holders", label: "Name placeholder for a vehicle", text: "Name of the {person}", vars: { person: "driver or rider" }, optional: true },
  "form.shirtSize": { group: "Ticket holders", label: "Shirt size label", text: "T-shirt size" },
  "form.plate": { group: "Ticket holders", label: "Plate label", text: "Plate number" },
  "form.platePlaceholder": { group: "Ticket holders", label: "Plate placeholder", text: "ABC 1234", optional: true },
  "form.model": { group: "Ticket holders", label: "Make and model label", text: "Make / model" },
  "form.photo": { group: "Ticket holders", label: "Vehicle photo label", text: "Photo of the {noun}", vars: { noun: "car or motorcycle" } },
  "form.photoHint": {
    group: "Ticket holders", label: "Vehicle photo hint", long: true, optional: true,
    text: "On your phone, **Take photo** opens the camera. A clear shot of the whole {noun}; it is compressed automatically before upload.",
    vars: { noun: "car or motorcycle" },
  },
  "form.passengersTitle": { group: "Ticket holders", label: "Passengers box heading", text: "Passengers riding with this car" },
  "form.passengersIncluded": {
    group: "Ticket holders", label: "Passengers box: included passengers", long: true,
    text: "This package includes a {reg} for **{passengers}** at no extra cost: the same {band} as the car, no shirt, since the package has one t-shirt for the driver. The name can be left blank for now.",
    vars: { ...REG, passengers: "e.g. 1 passenger", band: "the car's band colour, or the registration word" },
  },
  "form.passengersPaid": {
    group: "Ticket holders", label: "Passengers box: paid companions", long: true,
    text: "{who}: **{price}** per person, a **{companion}** {reg} with event t-shirt, added to your total. {Regs} are linked to plate **{plate}**. Up to {max} passengers per car.",
    vars: { ...REG, who: "\"Extra companions\" or \"Each companion\"", price: "companion price", companion: "companion ticket name", plate: "the plate typed above", max: "most passengers per car" },
  },
  "form.addCompanion": { group: "Ticket holders", label: "Add companion button", text: "+ Add companion" },
  "form.passengerName": { group: "Ticket holders", label: "Included passenger name label", text: "Passenger {n} full name", vars: { n: "1, 2 ..." } },
  "form.includedBadge": { group: "Ticket holders", label: "\"Included\" badge", text: "Included" },
  "form.extraCompanionName": { group: "Ticket holders", label: "Extra companion name label", text: "Extra companion {n} full name", vars: { n: "1, 2 ..." } },
  "form.passengerNote": { group: "Ticket holders", label: "What an included passenger gets", text: "{band}, lanyard and decal. No shirt.", vars: { band: "e.g. Red registration" } },
  "form.total": { group: "Ticket holders", label: "Total bar label", text: "Total" },
  "form.count": { group: "Ticket holders", label: "Total bar count", text: "{n} {items}", vars: { n: "how many", items: "registration or registrations (Terms)" } },

  /* ------------------------------------------------------- shirt delivery */
  "ship.note": {
    group: "Shirt delivery", label: "How shipped shirts work", long: true,
    text: "The shirt is made to order: {time} of processing, then it ships by LBC or J&T Express to your address. The shipping fee is shouldered by the buyer and is not included in the ticket total.",
    vars: { time: "how long a shipped shirt takes" },
  },
  "ship.noteTl": { group: "Shirt delivery", label: "How shipped shirts work (Tagalog)", long: true, optional: true, text: "Gagawin pa ang shirt: mga dalawang linggo bago ipadala sa LBC o J&T Express. Ang buyer ang magbabayad ng shipping fee; hindi ito kasama sa total." },
  "ship.toMe": { group: "Shirt delivery", label: "Send to the buyer checkbox", text: "Send it to me ({name}, {mobile})", vars: { name: "buyer's name", mobile: "buyer's mobile" } },
  "ship.recipientName": { group: "Shirt delivery", label: "Recipient name label", text: "Recipient's full name" },
  "ship.recipientMobile": { group: "Shirt delivery", label: "Recipient mobile label", text: "Recipient's mobile" },
  "ship.courierCalls": { group: "Shirt delivery", label: "Under the recipient mobile", text: "The courier calls this number.", optional: true },
  "ship.address": { group: "Shirt delivery", label: "Address label", text: "House / unit no., street, barangay" },
  "ship.addressPlaceholder": { group: "Shirt delivery", label: "Address placeholder", text: "e.g. Blk 3 Lot 12, Mabini St., Brgy. San Isidro", optional: true },
  "ship.city": { group: "Shirt delivery", label: "City label", text: "City / municipality" },
  "ship.province": { group: "Shirt delivery", label: "Province label", text: "Province" },
  "ship.zip": { group: "Shirt delivery", label: "ZIP label", text: "ZIP code" },
  "ship.courier": { group: "Shirt delivery", label: "Courier label", text: "Courier" },
  "ship.feeNote": { group: "Shirt delivery", label: "Under the courier choice", text: "The shipping fee is paid by you and is not part of the total below.", optional: true },
  "ship.via": { group: "Shirt delivery", label: "Courier line in summaries", text: "via {courier}", vars: { courier: "LBC or J&T Express" } },

  /* ------------------------------------------------------- shirt size chart */
  "shirt.kicker": { group: "Shirt size chart", label: "Small line above the title", text: "Event t-shirt", optional: true },
  "shirt.title": { group: "Shirt size chart", label: "Title", text: "Regular shirt size chart" },
  "shirt.intro": { group: "Shirt size chart", label: "Under the title", text: "All measurements are in inches. Lay a shirt that fits you flat and compare.", optional: true },
  "shirt.final": { group: "Shirt size chart", label: "Under the table", text: "Shirt sizes cannot be changed after tickets are issued, so double-check before you pay.", optional: true },
  "shirt.hint": { group: "Shirt size chart", label: "Under the size picker, before a size is chosen", text: "Measurements are in inches. Open the size chart if you are unsure.", optional: true },

  /* ------------------------------------------------------- review popup */
  "review.kicker": { group: "Review before paying", label: "Small line above the title", text: "Step 1 of 3 · Review", optional: true },
  "review.title": { group: "Review before paying", label: "Title", text: "Check your order" },
  "review.intro": { group: "Review before paying", label: "Under the title", text: "Nothing is reserved yet. Make sure every name is spelled the way it should appear on the ticket.", optional: true },
  "review.tickets": { group: "Review before paying", label: "List heading", text: "Tickets" },
  "review.count": { group: "Review before paying", label: "List count", text: "{n} total", vars: { n: "how many" } },
  "review.sendTo": { group: "Review before paying", label: "Buyer box heading", text: "Tickets will be sent to" },
  "review.shipTo": { group: "Review before paying", label: "Shipping box heading", text: "Shirt ships to" },
  "review.nextTitle": { group: "Review before paying", label: "Next steps heading", text: "What happens next" },
  "review.stepHold": { group: "Review before paying", label: "Step 1 (with a payment deadline)", text: "Your {regs} are held for **{minutes} minutes**.", vars: { ...REG, minutes: "payment window" } },
  "review.stepOpen": { group: "Review before paying", label: "Step 1 (no payment deadline)", text: "Your {regs} are reserved for you until you pay.", vars: REG },
  "review.stepPay": { group: "Review before paying", label: "Step 2", text: "Pay exactly **{total}** via {pay} and upload the confirmation screenshot.", vars: { total: "order total", pay: "payment channel" } },
  "review.stepVerify": { group: "Review before paying", label: "Step 3", long: true, text: "A team member verifies the payment by hand and emails your QR tickets and receipt **within 24 hours**, usually much sooner." },
  "review.spam": { group: "Review before paying", label: "Spam reminder after step 3", text: "Check your Spam or Junk folder if it does not show up in your inbox.", optional: true },
  "review.tlHold": {
    group: "Review before paying", label: "Tagalog summary (with a payment deadline)", long: true, optional: true,
    text: "Sa Tagalog: naka-hold ang {regs} ng {minutes} minuto. Bayaran ang eksaktong {total} via {app}, i-upload ang screenshot, at ipapadala ang tickets sa email pagkatapos ma-verify.",
    vars: { ...REG, minutes: "payment window", total: "order total", app: "payment app" },
  },
  "review.tlOpen": {
    group: "Review before paying", label: "Tagalog summary (no payment deadline)", long: true, optional: true,
    text: "Sa Tagalog: naka-reserve ang {regs} hanggang makapagbayad ka. Bayaran ang eksaktong {total} via {app}, i-upload ang screenshot, at ipapadala ang tickets sa email pagkatapos ma-verify.",
    vars: { ...REG, total: "order total", app: "payment app" },
  },
  "review.agree": { group: "Review before paying", label: "Agreement checkbox", long: true, text: "The names and details above are correct. I understand each {reg} is matched to the name on it and cannot be renamed after payment.", vars: REG },
  "review.back": { group: "Review before paying", label: "Back button", text: "← Go back and edit" },
  "review.confirm": { group: "Review before paying", label: "Confirm button", text: "Confirm & reserve" },

  /* ------------------------------------------------------- payment page */
  "pay.timeUp": { group: "Payment page", label: "When the timer runs out", long: true, text: "time is up. If you already paid, upload your proof below and your order will be restored" },
  "pay.accountName": { group: "Payment page", label: "Account name label", text: "Account:" },
  "pay.accountNumber": { group: "Payment page", label: "Account number label", text: "Account no.:" },
  "pay.statusLink": { group: "Payment page", label: "Link text for {statusLink}", text: "this status page" },

  /* ------------------------------------------------------- order status page */
  "order.title": { group: "Order status page", label: "Page title", text: "Order #{no}", vars: { no: "order number" } },
  "order.verifyTitle": { group: "Order status page", label: "Proof received: heading", text: "We received your proof of payment" },
  "order.verifyText": {
    group: "Order status page", label: "Proof received: text", long: true,
    text: "Reference {ref} via {channel}. A team member is now checking it against the account history. Your receipt and QR tickets will be emailed to **{email}** **within 24 hours**, usually much sooner. If it does not show up in your inbox, check your Spam or Junk folder and mark it as Not spam. Bookmark this page; it updates the moment your payment is confirmed.",
    vars: { ref: "payment reference", channel: "payment channel", email: "buyer's email" },
  },
  "order.rejectedTitle": { group: "Order status page", label: "Rejected: heading", text: "Payment could not be verified" },
  "order.rejectedReason": { group: "Order status page", label: "Rejected: reason line", text: "Reason: {reason}", vars: { reason: "the reason staff gave" } },
  "order.rejectedText": { group: "Order status page", label: "Rejected: what to do", long: true, text: "Reply to the email we sent with your payment details, or [place a new order](/)." },
  "order.expiredTitle": { group: "Order status page", label: "Expired: heading", text: "This order expired before payment was submitted" },
  "order.expiredText": { group: "Order status page", label: "Expired: text", long: true, text: "The {regs} were released back to the pool, so this order can no longer be paid. [Place a new order](/) while tickets are still available.", vars: REG },
  "order.expiredPaid": { group: "Order status page", label: "Expired: already paid", long: true, text: "**Already paid?** Do not pay again. Contact the organizer below with your order number and payment reference.", optional: true },
  "order.expiredTl": {
    group: "Order status page", label: "Expired: Tagalog", long: true, optional: true,
    text: "Kanselado na ang order at naibalik na sa pool ang {regs}, kaya mag-order ulit. Kung nakabayad ka na, huwag nang magbayad ulit, kontakin ang organizer sa ibaba at sabihin ang order number at reference number mo.",
    vars: REG,
  },
  "order.refundTitle": { group: "Order status page", label: "Changed ticket, refund due: heading", text: "A refund is on its way" },
  "order.balanceTitle": { group: "Order status page", label: "Changed ticket, balance due: heading", text: "There is still a balance to pay" },
  "order.changed": { group: "Order status page", label: "Changed ticket: first sentence", text: "Your order was changed to a different ticket." },
  "order.refundText": { group: "Order status page", label: "Refund due", text: "**{amount}** will be returned to the account you paid from{when}.", vars: { amount: "refund amount", when: "\" — sent on <date>\" once sent" } },
  "order.refundSent": { group: "Order status page", label: "Refund sent (fills {when})", text: " — sent on {date}", vars: { date: "date sent" } },
  "order.balanceText": { group: "Order status page", label: "Balance due", text: "**{amount}** is still to be paid{when}. Your tickets below are already valid.", vars: { amount: "amount due", when: "\" — received on <date>\" once received" } },
  "order.balanceReceived": { group: "Order status page", label: "Balance received (fills {when})", text: " — received on {date}", vars: { date: "date received" } },
  "order.balanceTl": { group: "Order status page", label: "Changed ticket: Tagalog", text: "Kontakin ang organizer at banggitin ang order number kung may tanong.", optional: true },
  "order.voidedTitle": { group: "Order status page", label: "Voided order: heading", text: "This order was voided" },
  "order.someVoidedTitle": { group: "Order status page", label: "Some tickets voided: heading", text: "Some tickets in this order were voided" },
  "order.voidedText": { group: "Order status page", label: "Voided: text", long: true, text: "Voided tickets are marked below and will not be accepted at the gate.{others} Reason: {reason}.", vars: { others: "\" Your other tickets stay valid.\" when only some are void", reason: "the reason staff gave" } },
  "order.voidedOthers": { group: "Order status page", label: "Voided: others still valid (fills {others})", text: " Your other tickets stay valid." },
  "order.voidedNoReason": { group: "Order status page", label: "Voided: when no reason was given", text: "see the email we sent" },
  "order.voidedTl": { group: "Order status page", label: "Voided: Tagalog", optional: true, text: "Hindi na tatanggapin sa gate ang mga naka-VOID na ticket. Kung may tanong o refund, kontakin ang organizer." },
  "order.summary": { group: "Order status page", label: "Summary heading", text: "Summary" },
  "order.total": { group: "Order status page", label: "Summary total", text: "Total" },
  "order.pdf": { group: "Order status page", label: "PDF button", text: "Download receipt & tickets (PDF)" },
  "order.shirtDelivery": { group: "Order status page", label: "Shirt delivery heading", text: "Shirt delivery" },
  "order.yourTickets": { group: "Order status page", label: "Tickets heading", text: "Your tickets" },
  "order.ticketsHint": { group: "Order status page", label: "Under the tickets heading", text: "Show each QR code at the gate. Each one admits one person once.", optional: true },
  "order.shirt": { group: "Order status page", label: "Ticket card: shirt", text: "Shirt {size}", vars: { size: "shirt size" } },
  "order.shirtShips": { group: "Order status page", label: "Ticket card: shirt ships", text: "Shirt {size} (ships to you)", vars: { size: "shirt size" } },
  "order.passengerOf": { group: "Order status page", label: "Ticket card: included passenger", text: "Passenger of car {plate} (included, no shirt)", vars: { plate: "car plate" } },
  "order.companionOf": { group: "Order status page", label: "Ticket card: paid companion", text: "Companion of car {plate}", vars: { plate: "car plate" } },

  /* ------------------------------------------------------- single ticket */
  "ticket.order": { group: "Single ticket page", label: "Order line", text: "Order #{no}", vars: { no: "order number" } },
  "ticket.void": { group: "Single ticket page", label: "Void ticket", long: true, text: "Not valid for entry{reason}. Contact the organizer with order #{no} if this is unexpected.", vars: { reason: "\": <reason>\" when one was given", no: "order number" } },
  "ticket.entered": { group: "Single ticket page", label: "Used ticket", text: "Entered {date}", vars: { date: "when it was scanned" } },
  "ticket.staffNote": { group: "Single ticket page", label: "Note for staff under the ticket", text: "Staff: open the [scanner](/scan) to admit this ticket.", optional: true },

  /* ------------------------------------------------------- help box */
  "help.compact": { group: "Help box", label: "Short version (registration page)", text: "Need help? Kailangan ng tulong?" },
  "help.title": { group: "Help box", label: "Full version: heading", text: "Stuck or something went wrong? Kailangan ng tulong?" },
  "help.text": { group: "Help box", label: "Full version: text", long: true, optional: true, text: "Paid but the timer ran out, wrong email, or no ticket email? Call or text the organizer and mention your order number. Tumawag o mag-text, sabihin ang order number mo." },

  /* ------------------------------------------------------- login and 404 */
  "nav.back": { group: "Staff login and missing page", label: "Back link (payment, order and login pages)", text: "Back to registration" },
  "login.kicker": { group: "Staff login and missing page", label: "Login: small line", text: "Staff only", optional: true },
  "login.title": { group: "Staff login and missing page", label: "Login: title", text: "Staff login" },
  "login.intro": { group: "Staff login and missing page", label: "Login: text", text: "Verify payments, check in drivers and riders at the gate, and manage registrations.", optional: true },
  "notFound.title": { group: "Staff login and missing page", label: "Missing page: title", text: "This page does not exist" },
  "notFound.text": { group: "Staff login and missing page", label: "Missing page: text", long: true, text: "The link may be incomplete or mistyped. If you are looking for your order, open the link from your email, or go back to the registration page.", optional: true },
  "notFound.textTl": { group: "Staff login and missing page", label: "Missing page: Tagalog", long: true, optional: true, text: "Maaaring kulang o mali ang link. Buksan ang link mula sa email mo, o bumalik sa registration page." },
  "notFound.button": { group: "Staff login and missing page", label: "Missing page: button", text: "Back to registration" },

  /* ------------------------------------------------------- search and sharing */
  "meta.description": { group: "Search and sharing", label: "Description for search results and shared links", long: true, text: "Buy tickets for {event}{at}. Pay via {pay}.", vars: { event: "event name", at: "\" at <venue>\" when a venue is set", pay: "payment channel" } },
  "meta.homeDescription": { group: "Search and sharing", label: "Description of the registration page", long: true, text: "{event}{at}. Pay via {pay}.", vars: { event: "event name", at: "\" at <venue>\" when a venue is set", pay: "payment channel" } },
} as const satisfies Record<string, TextDef>;

export type SiteTextKey = keyof typeof SITE_TEXT;
/** What Settings store: only the texts an admin changed. "" hides an optional text. */
export type TextOverrides = Partial<Record<SiteTextKey, string>>;
export type TextVars = Record<string, string | number>;

export const TEXT_GROUPS: TextGroup[] = [...new Set(Object.values(SITE_TEXT).map((d: TextDef) => d.group))];
export const MAX_TEXT_LENGTH = 1000;

/** Fill {placeholders}; unknown ones are left as typed so a typo shows on the page rather than vanishing. */
export const fillVars = (text: string, vars: TextVars = {}) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** "registration" in every form a text may ask for. */
export const regVars = (terms: { one: string; many: string }): TextVars => ({
  reg: terms.one,
  Reg: terms.one.charAt(0).toUpperCase() + terms.one.slice(1),
  regs: terms.many,
  Regs: terms.many.charAt(0).toUpperCase() + terms.many.slice(1),
});

/**
 * The text getter for a page: t("order.title", { no: 12 }) gives the admin's wording
 * or the default, filled. An optional text the admin emptied gives "", so
 * `{t(key) && ...}` drops it from the page.
 */
export function siteText(overrides: TextOverrides | undefined) {
  return (key: SiteTextKey, vars?: TextVars): string => {
    const own = overrides?.[key];
    const text = own !== undefined && (own !== "" || (SITE_TEXT[key] as TextDef).optional) ? own : SITE_TEXT[key].text;
    return fillVars(text, vars);
  };
}
export type TextGetter = ReturnType<typeof siteText>;
