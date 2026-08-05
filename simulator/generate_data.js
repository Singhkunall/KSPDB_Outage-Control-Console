const fs = require('fs');
const path = require('path');

function generateNetwork() {
    const numFeeders = 2;
    const numDts = 10; // Scaled down for local testing, representative shape
    const feeders = ["F-07-01", "F-07-02"];
    
    let transformers = [];
    let dtCounter = 1;

    for (let i = 0; i < numDts; i++) {
        let dtId = `D-${String(dtCounter).padStart(4, '0')}`;
        let feederId = feeders[Math.floor(Math.random() * feeders.length)];
        let lat = 12.9600 + (Math.random() * 0.04 - 0.02);
        let lon = 77.5800 + (Math.random() * 0.04 - 0.02);
        let capacityKva = [100, 250, 500][Math.floor(Math.random() * 3)];
        let households = Math.floor(capacityKva * 1.2);

        transformers.push({
            dt_id: dtId,
            feeder_id: feederId,
            lat: lat,
            lon: lon,
            capacity_kva: capacityKva,
            households_served: households
        });
        dtCounter++;
    }

    let poles = [];
    let poleCounter = 1;
    let deviceCounter = 1;

    for (let dt of transformers) {
        // ~60% of transformers have missing topology (seq_on_line & parent_pole_id empty)
        let missingTopology = Math.random() < 0.6;
        let numPolesForDt = Math.floor(Math.random() * 31) + 30; // 30 to 60 poles
        
        let lastPoleId = null;
        for (let seq = 1; seq <= numPolesForDt; seq++) {
            let poleId = `P-${String(poleCounter).padStart(6, '0')}`;
            let lat = dt.lat + (Math.random() * 0.01 - 0.005);
            let lon = dt.lon + (Math.random() * 0.01 - 0.005);
            
            // ~9% poles without a device
            let hasDevice = Math.random() >= 0.09;
            let deviceId = hasDevice ? `KSPDB-SD07-${dt.dt_id}-${String(deviceCounter).padStart(4, '0')}` : "";
            if (hasDevice) deviceCounter++;
                
            // ~3% missing pincode
            let pincode = Math.random() >= 0.03 ? "560078" : "";
            let ward = "W-084";
            let poleType = Math.random() > 0.5 ? "LT-9m-PCC" : "LT-8m-Steel";
            
            let seqOnLine = "";
            let parentPoleId = "";
            
            if (!missingTopology) {
                seqOnLine = seq;
                parentPoleId = lastPoleId ? lastPoleId : "";
                lastPoleId = poleId;
            }
                
            poles.push({
                pole_id: poleId,
                lat: lat,
                lon: lon,
                feeder_id: dt.feeder_id,
                dt_id: dt.dt_id,
                seq_on_line: seqOnLine,
                parent_pole_id: parentPoleId,
                pole_type: poleType,
                ward: ward,
                pincode: pincode,
                device_id: deviceId
            });
            poleCounter++;
        }
    }

    return { transformers, poles };
}

const { transformers, poles } = generateNetwork();

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir, { recursive: true });
}

// Write to CSV or JSON
fs.writeFileSync(path.join(dataDir, 'transformers.json'), JSON.stringify(transformers, null, 2));
fs.writeFileSync(path.join(dataDir, 'poles.json'), JSON.stringify(poles, null, 2));

console.log(`Generated ${transformers.length} transformers and ${poles.length} poles successfully in /data.`);