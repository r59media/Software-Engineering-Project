(function(){"use strict";const o=t=>document.querySelector(t),Te=t=>[...document.querySelectorAll(t)],r=t=>window.R59.formValidation?.escapeHtml(t)||String(t),P=["January","February","March","April","May","June","July","August","September","October","November","December"],ve=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];let L="month",h=N(new Date),be=100,A=null,R=null,U=null,x=null;function N(t){const e=t.getFullYear(),n=String(t.getMonth()+1).padStart(2,"0"),a=String(t.getDate()).padStart(2,"0");return`${e}-${n}-${a}`}function O(t){const[e,n,a]=t.split("-").map(Number);return new Date(e,n-1,a)}function Y(t){const e=new Date(t);return e.setHours(0,0,0,0),e.setDate(e.getDate()-e.getDay()),e}function ke(t){const e=Y(t);return e.setDate(e.getDate()+6),e}function we(t){return t.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}function ye(t){return t.toLocaleDateString("en-US",{month:"long",year:"numeric"})}function he(t,e){const n=t.getFullYear()===e.getFullYear(),a=t.toLocaleDateString("en-US",{month:"short",day:"numeric"}),i=e.toLocaleDateString("en-US",{month:"short",day:"numeric",...n?{}:{year:"numeric"}});return n?`${a} \u2013 ${i}, ${e.getFullYear()}`:`${a}, ${t.getFullYear()} \u2013 ${i}`}function te(t){if(!t)return"";const[e,n]=t.split(":").map(Number),a=e>=12?"PM":"AM",i=e%12||12;return`${String(i).padStart(2,"0")}:${String(n).padStart(2,"0")} ${a}`}function F(t){if(!t)return"";const e=String(t).trim(),n=e.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);if(n){let i=parseInt(n[1],10);const l=n[2],c=n[3].toUpperCase();return c==="PM"&&i<12&&(i+=12),c==="AM"&&i===12&&(i=0),`${String(i).padStart(2,"0")}:${l}`}const a=e.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);return a?`${String(parseInt(a[1],10)).padStart(2,"0")}:${a[2]}`:""}function C(t){const e=F(t);if(!e)return String(t||"");const[n,a]=e.split(":").map(Number);return`${n%12||12}:${String(a).padStart(2,"0")} ${n>=12?"PM":"AM"}`}function b(t){const e=Number(t||0);return"$"+e.toLocaleString("en-US",{minimumFractionDigits:Number.isInteger(e)?0:2,maximumFractionDigits:2})}const j=t=>Math.round(t*100)/100,ne=t=>t.date+" "+(F(t.time)||"00:00");function B(){const t=o("#calendarDisplay"),e=o("#calActiveRange"),n=o("#calPrev"),a=o("#calNext");if(!t)return;["Day","Week","Month"].forEach(l=>{const c=document.getElementById(`calBtn${l}`);if(c){const d=L===l.toLowerCase();c.classList.toggle("active",d),c.setAttribute("aria-pressed",String(d))}});const i=O(h);if(L==="month")e&&(e.textContent=ye(i)),n&&n.setAttribute("aria-label","Previous month"),a&&a.setAttribute("aria-label","Next month"),$e(t);else if(L==="week"){const l=Y(i),c=ke(i);e&&(e.textContent=he(l,c)),n&&n.setAttribute("aria-label","Previous week"),a&&a.setAttribute("aria-label","Next week"),De(t)}else e&&(e.textContent=we(i).toUpperCase()),n&&n.setAttribute("aria-label","Previous day"),a&&a.setAttribute("aria-label","Next day"),Se(t)}function ae(t,e,n={}){const a=new Date(t,e,1).getDay(),i=new Date(t,e+1,0).getDate(),l=Math.ceil((a+i)/7)*7,c=N(new Date),d=window.R59.state.getBookings(),u=window.R59.state.getBlockedDates();let s='<div class="cal-month-grid">';ve.forEach(v=>{s+=`<div class="cal-day-header">${v}</div>`});const m=n.chipAction==="edit"||!n.selectedStr&&!n.selectable;for(let v=0;v<l;v++){const p=new Date(t,e,v-a+1),g=N(p),k=p.getMonth()===e,D=d.filter(w=>w.date===g),$=u.find(w=>(w.dateStr||w.date)===g),y=D.length>0,T=g===n.selectedStr,f=g===c,S=m?"":` data-select-cal-date="${r(g)}"`,ee=D.map(w=>{const ge=String(w.status||"pending").toLowerCase(),fe=["confirmed","cancelled","pending"].includes(ge)?ge:"pending",Ee=m?`data-open-booking="${r(w.id)}"`:`data-select-day="${r(w.date)}"`;return`
          <div class="cal-event-chip ${fe==="cancelled"?"cancelled":""}" role="button" tabindex="0" ${Ee} title="${r(w.customer)} (${r(w.package)})">
            <span class="cal-event-time">${r(w.time)}</span>
            <strong class="cal-event-name">${r(w.customer)}</strong>
            <span class="cal-event-pkg">${r(w.package)}</span>
            <span class="status-badge status-${fe}" style="font-size: 9px; padding: 1px 5px;">${r(w.status||"Pending")}</span>
          </div>
        `}).join(""),Me=$?`
        <div class="cal-blocked-tag">Blocked: ${r($.reason||"Unavailable")}</div>
      `:"";s+=`
        <div class="cal-day-cell ${k?"":"other-month"} ${y?"has-booking":""} ${$?"cal-blocked":""} ${T?"cal-selected":""}" role="button" tabindex="0"${S}>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cal-day-num">${p.getDate()}</span>
            ${f?'<span class="status-badge status-available" style="font-size:9px;padding:1px 5px;">Today</span>':""}
            ${y?`<span class="hint" style="font-size: 10px; color: var(--yellow);">${D.length}</span>`:""}
          </div>
          ${Me}
          ${ee}
        </div>
      `}return s+="</div>",s}function $e(t){const e=O(h);t.innerHTML=ae(e.getFullYear(),e.getMonth(),{selectedStr:h,selectable:!0})}function De(t){const e=O(h),n=Y(e),a=window.R59.state.getBookings(),i=window.R59.state.getBlockedDates(),l=Array.from({length:7},(d,u)=>{const s=new Date(n);return s.setDate(n.getDate()+u),{name:s.toLocaleDateString("en-US",{weekday:"short"}),dateNum:s.getDate(),dateStr:N(s)}});let c='<div class="cal-week-grid">';l.forEach(d=>{const u=a.filter(p=>p.date===d.dateStr),s=i.find(p=>(p.dateStr||p.date)===d.dateStr),m=h===d.dateStr,v=u.length>0?u.map(p=>{const g=String(p.status||"pending").toLowerCase(),k=["confirmed","cancelled","pending"].includes(g)?g:"pending";return`
            <div class="cal-event-chip ${k==="cancelled"?"cancelled":""}" role="button" tabindex="0" data-select-day="${r(p.date)}" style="padding: 8px;">
              <span class="cal-event-time">${r(p.timeRange||p.time)}</span>
              <strong class="cal-event-name" style="font-size: 13px;">${r(p.customer)}</strong>
              <span class="cal-event-pkg" style="font-size: 11px;">${r(p.package)}</span>
              <div style="margin-top: 4px;">
                <span class="status-badge status-${k}">${r(p.status||"Pending")}</span>
              </div>
            </div>
          `}).join(""):s?`<div class="cal-blocked-tag" style="margin-top: 10px; text-align: center;">Blocked: ${r(s.reason||"Unavailable")}</div>`:'<span class="hint" style="font-size: 12px; text-align: center; margin-top: 20px;">No bookings</span>';c+=`
        <div class="cal-week-col ${s?"cal-blocked":""} ${m?"cal-selected":""}" role="button" tabindex="0" data-select-cal-date="${r(d.dateStr)}">
          <div class="cal-week-col-head">
            <div class="cal-week-col-name">${d.name}</div>
            <div class="cal-week-col-date">${d.dateNum}</div>
          </div>
          ${v}
        </div>
      `}),c+="</div>",t.innerHTML=c}function Se(t){const e=window.R59.state.getBookings(),n=window.R59.state.getBlockedDates(),a=[...new Set(e.map(s=>s.date))],i=a.length>0?`
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        ${a.map(s=>{const m=e.find(p=>p.date===s);return`
            <button type="button" class="btn btn-sm ${h===s?"btn-primary":""}" data-select-day="${r(s)}">
              ${r(m&&m.dateLabel||s)}
            </button>
          `}).join("")}
      </div>
    `:"",l=[{label:"09:00 AM",time24:"09:00"},{label:"10:00 AM",time24:"10:00"},{label:"11:00 AM",time24:"11:00"},{label:"12:00 PM",time24:"12:00"},{label:"01:00 PM",time24:"13:00"},{label:"02:00 PM",time24:"14:00"},{label:"03:00 PM",time24:"15:00"},{label:"04:00 PM",time24:"16:00"},{label:"05:00 PM",time24:"17:00"}],c=e.filter(s=>s.date===h),d=n.find(s=>(s.dateStr||s.date)===h);let u='<div class="cal-day-timeline">';d&&(u+=`
        <div style="background: rgba(255, 34, 34, 0.1); border: 1px solid var(--red); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
          <strong style="color: var(--red);">Date Blocked:</strong> ${r(d.reason||"Unavailable")} \u2014 No bookings allowed.
        </div>
      `),l.forEach(s=>{const m=c.find(v=>{const p=F(v.time||v.start_time);if(!p)return!1;const g=parseInt(p.split(":")[0],10),k=parseInt(s.time24.split(":")[0],10);return g===k});if(m){const v=(m.status||"pending").toLowerCase(),p=["confirmed","pending","cancelled"].includes(v)?v:"pending";u+=`
          <div class="cal-timeline-row" style="border-left: 3px solid var(--yellow); background: rgba(255, 204, 34, 0.05);">
            <div class="cal-timeline-time">${s.label}</div>
            <div class="cal-timeline-content">
              <div>
                <div style="font-weight: 700; font-size: 14px;">${r(m.customer)} \u2014 ${r(m.package)}</div>
                <div class="hint">${r(m.timeRange||m.time)} \xB7 Price: ${b(m.price)} \xB7 Down Payment: ${b(m.deposit)} \xB7 Balance: ${b(m.price-m.deposit)}</div>
              </div>
              <div>
                <span class="status-badge status-${p}">${r(m.status||"Pending")}</span>
              </div>
            </div>
          </div>
        `}else u+=`
          <div class="cal-timeline-row">
            <div class="cal-timeline-time">${s.label}</div>
            <div class="cal-timeline-content">
              <span class="hint" style="color: var(--muted);">Available slot</span>
              <span class="status-badge status-available">Open</span>
            </div>
          </div>
        `}),u+="</div>",t.innerHTML=i+u}function oe(t){const e=O(h);if(L==="day")e.setDate(e.getDate()+t);else if(L==="week")e.setDate(e.getDate()+t*7);else{const n=e.getDate();e.setDate(1),e.setMonth(e.getMonth()+t);const a=new Date(e.getFullYear(),e.getMonth()+1,0).getDate();e.setDate(Math.min(n,a))}h=N(e),B()}function M(){const t=o("#availabilityList");if(!t)return;const e=window.R59.state.getAvailability();t.innerHTML=e.map(n=>{const a=A===n.day,i=n.available&&n.timeframes&&n.timeframes.length>0?`
          <div class="avail-slots-list">
            ${n.timeframes.map(s=>`
              <div class="avail-slot-row">
                <div>
                  <strong>${r(s.label)}</strong>
                  <span class="tf-badge ${s.repeat==="weekly"?"tf-repeat":"tf-norepeat"}" style="margin-left: 6px;">
                    ${s.repeat==="weekly"?"Repeat weekly":"Does not repeat"}
                  </span>
                </div>
                <div class="avail-slot-actions">
                  <button type="button" class="btn btn-sm" data-edit-timeframe-day="${r(n.day)}" data-edit-timeframe-id="${Number(s.id)}" style="padding: 3px 8px; font-size: 11px;">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-remove-timeframe-day="${r(n.day)}" data-remove-timeframe-id="${Number(s.id)}" style="padding: 3px 8px; font-size: 11px;">Remove</button>
                </div>
              </div>
            `).join("")}
          </div>
        `:'<div class="hint" style="color: var(--muted); font-size: 13px;">Unavailable</div>';let l="weekly",c="09:00",d="17:00";if(R){const s=n.timeframes?.find(m=>m.id===R);s&&(c=s.start,d=s.end,l=s.repeat||"weekly")}const u=a?`
        <div class="timeframe-form">
          <div style="font-weight: 700; font-size: 13px; color: var(--accent-text);">
            ${R?"Edit Timeframe":"Add Timeframe"} for ${r(n.day)}
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">Start Time</label>
              <input type="time" class="input" id="tfStart" style="width: auto; padding: 6px 8px;" value="${r(c)}">
            </div>
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">End Time</label>
              <input type="time" class="input" id="tfEnd" style="width: auto; padding: 6px 8px;" value="${r(d)}">
            </div>
          </div>
          <div>
            <div class="hint" style="font-weight: 600; margin-bottom: 6px; color: var(--text-soft);">Repeat:</div>
            <div style="display: flex; gap: 16px; align-items: center;">
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatNone" value="none" ${l==="none"?"checked":""} style="accent-color: var(--yellow);">
                Does not repeat
              </label>
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatWeekly" value="weekly" ${l==="weekly"?"checked":""} style="accent-color: var(--yellow);">
                Repeat weekly
              </label>
            </div>
          </div>
          <div class="row" style="gap: 8px;">
            <button type="button" class="btn btn-primary btn-sm" data-save-timeframe-day="${r(n.day)}">Save Timeframe</button>
            <button type="button" class="btn btn-sm" data-cancel-timeframe="true">Cancel</button>
          </div>
        </div>
      `:"";return`
        <div class="avail-day-card">
          <div class="avail-day-head">
            <div class="avail-day-title">
              <strong>${r(n.day)}</strong>
              <span class="status-badge ${n.available&&n.timeframes?.length>0?"status-available":"status-unavailable"}">
                ${n.available&&n.timeframes?.length>0?"Available":"Unavailable"}
              </span>
            </div>
            <button type="button" class="btn btn-sm" data-add-timeframe-day="${r(n.day)}">+ Add Timeframe</button>
          </div>
          ${i}
          ${u}
        </div>
      `}).join("")}function W(t){A=t,R=null,M()}function _(t,e){A=t,R=e,M()}function J(){A=null,R=null,M()}function q(t){const e=o("#tfStart")?.value||"09:00",n=o("#tfEnd")?.value||"17:00",a=o('input[name="tfRepeat"]:checked')?.value||"weekly",l=window.R59.state.getAvailability().find(d=>d.day===t);if(!l)return;l.timeframes=l.timeframes||[];const c=`${te(e)} \u2013 ${te(n)}`;if(R){const d=l.timeframes.find(u=>u.id===R);d&&(d.start=e,d.end=n,d.label=c,d.repeat=a),window.toast("Timeframe updated")}else l.timeframes.push({id:++be,start:e,end:n,label:c,repeat:a}),l.available=!0,window.toast("Timeframe added");A=null,R=null,M(),window.R59.state.markDirty()}function G(t,e){const a=window.R59.state.getAvailability().find(l=>l.day===t);if(!a)return;const i=a.timeframes?.find(l=>l.id===e);i&&window.R59.confirmation.confirmRemoveTimeframe(i.label,t,()=>{a.timeframes=a.timeframes.filter(l=>l.id!==e),a.timeframes.length===0&&(a.available=!1),M(),window.R59.state.markDirty(),window.toast("Timeframe removed")})}function I(){const t=o("#blockedDatesList");if(!t)return;const e=window.R59.state.getBlockedDates();if(e.length===0){t.innerHTML='<p class="hint">No dates are currently blocked.</p>';return}t.innerHTML=e.map(n=>`
      <div class="blocked-date-item">
        <div>
          <div style="font-family: var(--display); font-size: 15px; font-weight: 700; color: var(--text);">${r(n.dateFormatted||n.dateStr||n.date)}</div>
          <div class="hint" style="color: var(--muted);">${r(n.reason||"Blocked date")}</div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-block="${r(n.id)}">Remove</button>
      </div>
    `).join("")}function K(t){const e=window.R59.state.getBlockedDates(),n=e.find(a=>String(a.id)===String(t));n&&window.R59.confirmation.confirmRemoveBlockedDate(n.dateFormatted||n.dateStr||n.date,()=>{window.R59.state.setBlockedDates(e.filter(a=>String(a.id)!==String(t))),n?.id&&window.R59.api?.schedule?.removeBlockedDate&&window.R59.api.schedule.removeBlockedDate(n.id).catch(a=>console.warn("[schedule] Failed to remove blocked date:",a)),I(),B(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty(),window.toast("Date unblocked")})}function Re(){const t=o("#blockDateInput")?.value,e=o("#blockReasonInput")?.value.trim();if(!t||!window.R59.formValidation?.isValidISODate(t)){window.toast("Please choose a valid date to block");return}const[n,a,i]=t.split("-").map(Number),l=`${P[a-1]} ${i}, ${n}`;window.R59.confirmation.confirmBlockDate(l,()=>Be(t,e,l))}function Be(t,e,n){const a=window.R59.state.getBlockedDates(),i={id:Date.now(),date:t,dateStr:t,dateFormatted:n,reason:e||"Unavailable"};a.push(i),window.R59.api?.schedule?.addBlockedDate&&window.R59.api.schedule.addBlockedDate({date:t,reason:e||"Unavailable"}).then(d=>{d?.id&&(i.id=d.id,I())}).catch(d=>console.warn("[schedule] Failed to add blocked date:",d)),o("#blockDateInput").value="",o("#blockReasonInput").value="",I(),B(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty();const c=window.R59.state.getBookings().filter(d=>d.date===t&&d.status!=="Cancelled").length;window.toast(c?`Date blocked \u2014 note: ${c} existing booking${c>1?"s":""} on that day ${c>1?"are":"is"} not cancelled`:"Date blocked")}function xe(t){const e=Math.max(0,(t.price||0)-(t.deposit||0)),n=t.status==="Cancelled",a=String(t.status||"pending").toLowerCase(),i=["confirmed","cancelled","pending"].includes(a)?a:"pending";return`
      <div class="booking-item ${n?"cancelled":""}">
        <div class="booking-head">
          <div>
            <div class="booking-time">${r(t.time||"")}</div>
            <div class="booking-client">${r(t.customer||"Unknown Client")}</div>
            <div class="booking-pkg">${r(t.package||"Custom Session")}</div>
            ${t.email||t.phone?`<div class="booking-pkg">${r(t.email||"")}${t.email&&t.phone?" \xB7 ":""}${r(t.phone||"")}</div>`:""}
            ${t.location?`<div class="booking-pkg">Location: ${r(t.location)}</div>`:""}
            ${t.attendees?`<div class="booking-pkg">${t.attendees} attendee${t.attendees>1?"s":""}${t.coupon&&typeof t.coupon=="object"?` \xB7 Coupon ${r(t.coupon.code)} (\u2212${b(t.coupon.discount)})`:""}</div>`:""}
            ${t.notes?`<div class="booking-notes">Notes: ${r(t.notes)}</div>`:""}
          </div>
          <div>
            <span class="status-badge status-${i}">${r(t.status||"Pending")}</span>
          </div>
        </div>

        <div class="booking-financials">
          <div class="financial-stat">
            <span>Session Price</span>
            <b>${b(t.price)}</b>
          </div>
          <div class="financial-stat">
            <span>Down Payment</span>
            <b>${b(t.deposit)}</b>
          </div>
          <div class="financial-stat">
            <span>Remaining Balance</span>
            <b>${b(e)}</b>
          </div>
        </div>

        <div class="booking-foot">
          <button type="button" class="btn btn-sm" data-edit-booking="${r(t.id)}">Edit</button>
          ${n?`<button type="button" class="btn btn-danger btn-sm" data-delete-booking="${r(t.id)}">Remove</button>`:`<button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${r(t.id)}">Cancel Booking</button>`}
        </div>
      </div>`}function ie(t,e){if(!t||t.length===0)return`<p class="hint">${e}</p>`;const n=[...t].sort((i,l)=>ne(i).localeCompare(ne(l))),a=new Map;return n.forEach(i=>{const l=i.dateLabel||i.date;a.has(l)||a.set(l,[]),a.get(l).push(i)}),[...a.entries()].map(([i,l])=>`
      <div class="booking-group">
        <div class="booking-date-head">
          <span>${r(i)}</span>
          <span class="hint">${l.length} booking${l.length>1?"s":""}</span>
        </div>
        ${l.map(xe).join("")}
      </div>`).join("")}function Q(){const t=o("#bookingsList"),e=window.R59.state.getBookings();t&&(t.innerHTML=ie(e,"No bookings scheduled.")),se(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview()}function se(){const e=window.R59.state.getBookings().filter(c=>c.status==="Cancelled"),n=(c,d,u)=>{const s=o(c);s&&(s.style.display=d>0?"":"none",s.textContent=`${u} (${d})`)};n("#btnClearCancelled",e.length,"Clear all cancelled");const a=window.R59.dashboard?.getYear?window.R59.dashboard.getYear():new Date().getFullYear(),i=window.R59.dashboard?.getMonth?window.R59.dashboard.getMonth():new Date().getMonth(),l=e.filter(c=>{const[d,u]=c.date.split("-").map(Number);return d===a&&u-1===i});n("#ovClearCancelled",l.length,"Clear cancelled")}function X(t){const e=window.R59.state.getBookings(),n=e.find(a=>String(a.id)===String(t));!n||n.status!=="Cancelled"||window.R59.confirmation.confirmRemoveBooking(n,()=>{window.R59.state.setBookings(e.filter(a=>String(a.id)!==String(t))),window.R59.api?.bookings?.deleteBooking&&window.R59.api.bookings.deleteBooking(t).catch(a=>console.warn("[schedule] Failed to delete booking:",a)),E(),window.toast("Cancelled booking removed")})}function Z(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));!n||n.status==="Cancelled"||window.R59.confirmation.confirmCancelBooking(n,()=>{n.status="Cancelled",window.R59.api?.bookings?.cancelBooking&&window.R59.api.bookings.cancelBooking(t).catch(a=>console.warn("[schedule] Failed to cancel booking:",a)),E(),window.toast(`Booking cancelled \u2014 ${b(n.deposit)} down payment marked for reimbursement`)})}function le(t,e){window.R59.confirmation.confirmClearCancelled(e.length,t,()=>{const n=window.R59.state.getBookings(),a=e.map(String);window.R59.state.setBookings(n.filter(i=>!a.includes(String(i.id)))),window.R59.api?.bookings?.deleteBooking&&e.forEach(i=>{window.R59.api.bookings.deleteBooking(i).catch(l=>console.warn("[schedule] Failed to clear booking:",l))}),E(),window.toast(`${e.length} cancelled booking${e.length>1?"s":""} cleared`)})}function E(){Q(),B()}function V(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));n&&(U=n.id,o("#bkCustomer").value=n.customer||"",o("#bkPackage").value=n.package||"",o("#bkLocation").value=n.location||"",o("#bkNotes").value=n.notes||"",o("#bkEmail").value=n.email||"",o("#bkPhone").value=n.phone||"",o("#bkAttendees").value=n.attendees||"",o("#bkDate").value=n.date||"",o("#bkStart").value=F(n.time),o("#bkEnd").value=F(n.end_time||(n.timeRange||"").split(/[-–]/)[1]||""),o("#bkPrice").value=n.price||0,o("#bkDeposit").value=n.deposit||0,o("#bkStatus").value=n.status||"Pending",o("#bkError").textContent="",o("#bkRefundNote").style.display="none",x=document.activeElement,o("#bookingModal").classList.add("open"),o("#bkCustomer").focus())}function H(){o("#bookingModal")?.classList.remove("open"),U=null,x&&typeof x.focus=="function"&&x.focus()}function Ce(){const e=window.R59.state.getBookings().find(f=>String(f.id)===String(U));if(!e)return H();const n=o("#bkCustomer").value.trim(),a=o("#bkPackage").value.trim(),i=o("#bkDate").value,l=o("#bkStart").value,c=o("#bkEnd").value,d=parseFloat(o("#bkPrice").value),u=parseFloat(o("#bkDeposit").value),s=f=>{o("#bkError").textContent=f};if(!n)return s("Please enter the customer name.");if(!a)return s("Please enter a package.");const m=o("#bkEmail").value.trim(),v=o("#bkPhone").value.trim(),p=v&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(v):v,g=o("#bkAttendees").value.trim();if(m&&!window.R59.formValidation.isValidEmail(m))return s("Please enter a valid email address.");if(p&&!window.R59.formValidation.isValidPhone(p))return s("Please enter a valid phone number (10+ digits).");if(g&&!(parseInt(g,10)>=1))return s("Attendees must be at least 1.");if(!i||!window.R59.formValidation.isValidISODate(i))return s("Please choose a valid date.");const D=window.R59.state.getBlockedDates().find(f=>f.dateStr===i);if(D&&i!==e.date&&o("#bkStatus").value!=="Cancelled")return s(`That date is blocked (${D.reason||"Unavailable"}). Pick another date.`);if(!l)return s("Please choose a start time.");if(c&&c<=l)return s("End time must be after the start time.");if(!(d>=0))return s("Please enter a valid session price.");if(!(u>=0))return s("Please enter a valid down payment.");if(u>d)return s("Down payment cannot be more than the session price.");const[$,y,T]=i.split("-").map(Number);window.R59.confirmation.confirmSaveBooking(n,`${P[y-1]} ${T}, ${$}`,!1,()=>{Object.assign(e,{customer:n,package:a,date:i,email:m,phone:p,location:o("#bkLocation").value.trim(),notes:o("#bkNotes").value.trim(),attendees:g?parseInt(g,10):void 0,dateFormatted:`${P[y-1]} ${T}, ${$}`,dateLabel:`${P[y-1].toUpperCase()} ${T}, ${$}`,time:C(l),timeRange:c?`${C(l)} \u2013 ${C(c)}`:C(l),price:d,deposit:u,status:o("#bkStatus").value}),window.R59.api?.bookings?.updateBooking&&window.R59.api.bookings.updateBooking(e.id,{customer_name:e.customer,customer_email:e.email,phone:e.phone,location:e.location,notes:e.notes,attendees:e.attendees,date:e.date,startTime:l,endTime:c,price:e.price,deposit:e.deposit,status:e.status}).catch(f=>console.warn("[schedule] Failed to update booking:",f)),H(),E(),window.toast("Booking updated")})}function de(){const t=window.R59.state.getState(),e=parseFloat(t.pricing.depositPercent);return(isNaN(e)?50:Math.min(100,Math.max(0,e)))/100}function re(){return(window.R59.state.getState().packages||[]).filter(n=>n.active)}function ce({pkgPrice:t,attendees:e,coupon:n}){const a=window.R59.state.getState(),i=parseFloat(a.pricing.baseFee)||0,l=parseFloat(a.pricing.perPerson)||0,c=l*e,d=t+i+c;let u=0;n&&(u=n.type==="percent"?d*n.amount/100:Math.min(n.amount,d)),u=j(u);const s=j(Math.max(0,d-u));return{base:i,perPerson:l,attendeeFee:c,subtotal:d,discount:u,total:s,deposit:j(s*de())}}function ue(){const t=o("#nbPackage").value;return t==="none"?{key:"none",name:"No package",price:0,none:!0}:re().find(e=>String(e.id)===String(t))||{key:"custom",name:"Custom",price:0}}function me(){const t=o("#nbSummary");if(!t)return;const e=ue(),n=Math.max(1,parseInt(o("#nbAttendees").value,10)||1),a=ce({pkgPrice:e.price||0,attendees:n});t.innerHTML=`
      ${e.none?"":`<div class="ps-row"><span>${r(e.name)} package</span><b>${b(e.price)}</b></div>`}
      <div class="ps-row"><span>Base fee</span><b>${b(a.base)}</b></div>
      <div class="ps-row"><span>Attendees (${n} \xD7 ${b(a.perPerson)})</span><b>${b(a.attendeeFee)}</b></div>
      <div class="ps-row total"><span>Total</span><b>${b(a.total)}</b></div>
      <div class="ps-row"><span>Down payment (${Math.round(de()*100)}%)</span><b>${b(a.deposit)}</b></div>`}function pe(){["#nbFirst","#nbLast","#nbEmail","#nbPhone","#nbDate","#nbStart","#nbEnd","#nbLocation","#nbNotes"].forEach(n=>{const a=o(n);a&&(a.value="")}),o("#nbAttendees").value=1,o("#nbError").textContent="";const t=re(),e=o("#nbPackage");e&&(e.innerHTML=t.map(n=>`<option value="${r(n.id)}">${r(n.name)} \u2014 ${b(n.price)}</option>`).join("")+'<option value="none">No package</option>'),me(),x=document.activeElement,o("#newBookingModal").classList.add("open"),o("#nbFirst").focus()}function z(){o("#newBookingModal")?.classList.remove("open"),x&&typeof x.focus=="function"&&x.focus()}function Pe(){const t=y=>{o("#nbError").textContent=y},e=o("#nbFirst").value.trim(),n=o("#nbLast").value.trim(),a=o("#nbEmail").value.trim(),i=o("#nbPhone").value.trim(),l=i&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(i):i,c=parseInt(o("#nbAttendees").value,10),d=o("#nbDate").value,u=o("#nbStart").value,s=o("#nbEnd").value,m=ue();if(!e)return t("Please enter a first name.");if(!n)return t("Please enter a last name.");if(!window.R59.formValidation.isValidEmail(a))return t("Please enter a valid email address.");if(!window.R59.formValidation.isValidPhone(l))return t("Please enter a valid phone number (10+ digits).");if(!(c>=1))return t("Number of attendees must be at least 1.");if(!d||!window.R59.formValidation.isValidISODate(d))return t("Please choose a valid date for the booking.");if(!u)return t("Please choose a start time.");if(s&&s<=u)return t("End time must be after the start time.");const p=window.R59.state.getBlockedDates().find(y=>y.dateStr===d);if(p)return t(`That date is blocked (${p.reason||"Unavailable"}). Unblock it first or pick another date.`);const g=ce({pkgPrice:m.price||0,attendees:c}),[k,D,$]=d.split("-").map(Number);window.R59.confirmation.confirmSaveBooking(`${e} ${n}`,`${P[D-1]} ${$}, ${k}`,!0,()=>{const y=window.R59.state.getBookings(),f={id:y.reduce((S,ee)=>Math.max(S,Number(ee.id)||0),0)+1,date:d,dateLabel:`${P[D-1].toUpperCase()} ${$}, ${k}`,dateFormatted:`${P[D-1]} ${$}, ${k}`,time:C(u),timeRange:s?`${C(u)} \u2013 ${C(s)}`:C(u),customer:`${e} ${n}`,firstName:e,lastName:n,email:a,phone:l,attendees:c,location:o("#nbLocation").value.trim(),notes:o("#nbNotes").value.trim(),package:m.name,price:g.total,deposit:g.deposit,coupon:null,status:"Confirmed"};y.push(f),window.R59.api?.bookings?.createBooking&&window.R59.api.bookings.createBooking({client_name:f.customer,client_email:f.email,phone:f.phone,location:f.location,notes:f.notes,people:f.attendees,date:f.date,startTime:u,endTime:s,packageId:m.id&&m.id!=="none"&&m.id!=="custom"?m.id:void 0,totalPrice:f.price,deposit:f.deposit,status:"confirmed"}).then(S=>{(S?.data?.id||S?.id)&&(f.id=S?.data?.id||S?.id,E())}).catch(S=>console.warn("[schedule] Failed to persist new booking:",S)),z(),E(),window.toast(`Booking created for ${e} ${n}`)})}function Le(){["Day","Week","Month"].forEach(e=>{document.getElementById(`calBtn${e}`)?.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),L=e.toLowerCase(),B()})}),o("#calPrev")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),oe(-1)}),o("#calNext")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),oe(1)}),o("#btnBlockDate")?.addEventListener("click",Re),o("#btnAddBooking")?.addEventListener("click",pe),o("#btnClearCancelled")?.addEventListener("click",()=>{const n=window.R59.state.getBookings().filter(a=>a.status==="Cancelled").map(a=>a.id);n.length&&le("",n)}),o("#nbCancel")?.addEventListener("click",z),o("#nbSave")?.addEventListener("click",Pe),["#nbPackage","#nbAttendees"].forEach(e=>o(e)?.addEventListener("input",me)),o("#newBookingModal")?.addEventListener("click",e=>{e.target.id==="newBookingModal"&&z()});const t=o("#bkStatus");t&&t.addEventListener("change",()=>{const n=window.R59.state.getBookings().find(i=>String(i.id)===String(U)),a=o("#bkRefundNote");a&&(a.style.display=t.value==="Cancelled"&&n&&n.status!=="Cancelled"?"block":"none")}),o("#bkSave")?.addEventListener("click",Ce),o("#bkCancel")?.addEventListener("click",H),o("#bookingModal")?.addEventListener("click",e=>{e.target.id==="bookingModal"&&H()}),document.addEventListener("click",e=>{const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),V(a.dataset.openBooking);return}const i=n.closest("[data-edit-booking]");if(i){e.preventDefault(),V(i.dataset.editBooking);return}const l=n.closest("[data-cancel-booking]");if(l){e.preventDefault(),Z(l.dataset.cancelBooking);return}const c=n.closest("[data-delete-booking]");if(c){e.preventDefault(),X(c.dataset.deleteBooking);return}const d=n.closest("[data-select-day]");if(d){e.preventDefault(),window.R59.schedule.selectDayView(d.dataset.selectDay);return}const u=n.closest("[data-select-cal-date]");if(u){e.preventDefault(),window.R59.schedule.selectCalendarDate(u.dataset.selectCalDate);return}const s=n.closest("[data-add-timeframe-day]");if(s){e.preventDefault(),W(s.dataset.addTimeframeDay);return}const m=n.closest("[data-save-timeframe-day]");if(m){e.preventDefault(),q(m.dataset.saveTimeframeDay);return}if(n.closest("[data-cancel-timeframe]")){e.preventDefault(),J();return}const p=n.closest("[data-edit-timeframe-day]");if(p){e.preventDefault(),_(p.dataset.editTimeframeDay,Number(p.dataset.editTimeframeId));return}const g=n.closest("[data-remove-timeframe-day]");if(g){e.preventDefault(),G(g.dataset.removeTimeframeDay,Number(g.dataset.removeTimeframeId));return}const k=n.closest("[data-remove-block]");if(k){e.preventDefault(),K(k.dataset.removeBlock);return}}),document.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" "&&e.key!=="Spacebar")return;const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),V(a.dataset.openBooking);return}const i=n.closest("[data-select-day]");if(i){e.preventDefault(),window.R59.schedule.selectDayView(i.dataset.selectDay);return}const l=n.closest("[data-select-cal-date]");if(l){e.preventDefault(),window.R59.schedule.selectCalendarDate(l.dataset.selectCalDate);return}})}window.R59=window.R59||{},window.R59.schedule={renderCalendar:B,renderAvailability:M,renderBlockedDates:I,renderBookings:Q,refreshBookingViews:E,buildMonthGridHTML:ae,bookingsGroupedHTML:ie,syncClearCancelledButtons:se,selectCalendarDate:t=>{h=t,B()},selectDayView:t=>{h=t,L="day",B()},showAddTimeframe:W,editTimeframe:_,cancelTimeframe:J,saveTimeframe:q,removeTimeframe:G,removeBlockedDate:K,promptRemoveBooking:X,promptCancelBooking:Z,promptClearCancelled:le,openBookingEditor:V,closeBookingEditor:H,openNewBooking:pe,closeNewBooking:z,initScheduleListeners:Le},window.renderCalendar=B,window.renderAvailability=M,window.renderBlockedDates=I,window.renderBookings=Q,window.selectCalendarDate=window.R59.schedule.selectCalendarDate,window.selectDayView=window.R59.schedule.selectDayView,window.showAddTimeframe=W,window.editTimeframe=_,window.cancelTimeframe=J,window.saveTimeframe=q,window.removeTimeframe=G,window.removeBlockedDate=K,window.openBookingEditor=V,window.promptRemoveBooking=X,window.promptCancelBooking=Z})();
