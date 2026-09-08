/**
 * In-page autopilot used for automated browser testing of Harvest Rush.
 * Loaded via $B eval; drives the local kart around the loop.
 */
(function () {
  const hr = window.__hr;
  if (!hr) return 'no __hr';
  const S = hr.samples; // [x, z, road, y]
  const kd = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const ku = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
  const st = { held: new Set(), timer: null, laps: [], log: [] };
  function releaseAll() {
    for (const k of st.held) ku(k);
    st.held.clear();
  }
  function press(k) {
    if (!st.held.has(k)) {
      kd(k);
      st.held.add(k);
    }
  }
  function lift(k) {
    if (st.held.has(k)) {
      ku(k);
      st.held.delete(k);
    }
  }
  window.__botStop = () => {
    clearInterval(st.timer);
    releaseAll();
    st.timer = null;
    return 'stopped';
  };
  window.__botState = () => ({ laps: st.laps, log: st.log.slice(-8) });
  window.__bot = function (laps = 3) {
    window.__botStop();
    let lastLap = null;
    st.timer = setInterval(() => {
      const k = hr.getKart();
      if (lastLap === null) lastLap = k.lap;
      if (k.lap !== lastLap) {
        st.laps.push({ lap: k.lap, t: Date.now() });
        lastLap = k.lap;
      }
      if (k.lap >= laps) {
        window.__botStop();
        return;
      }
      // nearest road sample at a compatible height (ignore the other deck)
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < S.length; i++) {
        if (!S[i][2]) continue;
        if (Math.abs(S[i][3] - k.y) > 3.5) continue;
        const d = (S[i][0] - k.x) ** 2 + (S[i][1] - k.z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const offRoad = bd > 10 * 10;
      // aim further ahead at speed, tight look-ahead when off the road
      const step = offRoad ? 0 : Math.abs(k.speed) > 20 ? 3 : 2;
      const target = S[(bi + step) % S.length];
      const desired = (Math.atan2(target[0] - k.x, target[1] - k.z) * 180) / Math.PI;
      let err = desired - k.yaw;
      while (err > 180) err -= 360;
      while (err < -180) err += 360;
      // brake into sharp turns, keep momentum when far off the road so we
      // can always get back
      if (Math.abs(err) > 16 && !offRoad) {
        lift('w');
      } else {
        press('w');
      }
      if (err > 2.5) {
        press('a');
        lift('d');
      } else if (err < -2.5) {
        press('d');
        lift('a');
      } else {
        lift('a');
        lift('d');
      }
      if (st.log.length === 0 || Date.now() - st.log[st.log.length - 1].t > 1200) {
        st.log.push({ t: Date.now(), x: +k.x.toFixed(0), z: +k.z.toFixed(0), yaw: Math.round(k.yaw), desired: Math.round(desired), err: Math.round(err), keys: [...st.held].join(''), bi, off: offRoad });
      }
      // use items now and then so the effect pipeline gets exercised
      if (k.item && Math.random() < 0.02) {
        press('e');
        setTimeout(() => lift('e'), 120);
      }
    }, 55);
    return 'bot on';
  };
  return 'loaded';
})();
