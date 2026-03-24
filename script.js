
const params = new URLSearchParams(location.search);
const isReadOnly = params.get('mode') === 'view';
const token = params.get('token');
const isMapOnly = params.get('view') === 'map';

const map = L.map('map').setView([31.9, 35.03], 14);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

setTimeout(()=>map.invalidateSize(),300);

if(isReadOnly){
  document.body.classList.add('readonly');
  map.off('click');
}

if(isMapOnly){
  const j = document.getElementById('journal');
  if(j) j.style.display='none';
  document.getElementById('map').style.height='100vh';
}

function loadData(){
  if(token){
    console.log("load by token", token);
  } else {
    console.log("load by user");
  }
}
loadData();
