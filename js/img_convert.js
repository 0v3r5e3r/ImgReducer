async function loadPresetList()
{
    try{
        const res = await fetch("/ImgReducer/presets/presetList.json", {cache: "no-store"});
        const files = await res.json();

        const select = document.getElementById("preset-select");
        select.innerHTML = "";

        for (const preset of files){
            let id = preset.id;
            let name = preset.name;

            const option = document.createElement("option");
            option.value = id.toString();
            option.textContent = name.toString();
            select.appendChild(option);
        }
        const other_option = document.createElement("option");
        other_option.value = -1;
        other_option.textContent = "Upload Your Own";
        select.appendChild(other_option);
    }catch(error){
        console.error(error);
    }
}

function onOptionSelection(){
    var s = document.getElementById("preset-select");
    var u = document.getElementById("preset_upload");

    if (s.selectedIndex == s.children.length-1){
        // Show it
        u.style = "display: block;";
    } else {
        // Hide upload button
        // and clear it
        u.style = "display: none;";
    }

    console.log(u);
    console.log(u.style);
}

async function imageToBase64(file)
{
    return new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function load_preset(id)
{
    return new Promise((resolve,reject) => {
        fetch("/ImgReducer/presets/" + id.toString() + ".json", {cache: "no-store"})
        .then(response => resolve(response.json()))
        .catch(error => reject(error));
    });
}

async function read_uploaded_json(file) {
    return new Promise((resolve,reject) => {

        if(!file){
            reject("No file provided");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try{
                const jsonData = JSON.parse(e.target.result);
                resolve(jsonData);
            } catch(error) {
                reject(error);
                return;
            }
        }

        reader.readAsText(file);

    });
}

async function convert() {
    var input_canvas = document.getElementById("original_image");
    var output_canvas = document.getElementById("output_image");
    var output_parent = output_canvas.parentElement;

    var in_ctx = input_canvas.getContext("2d");
    var out_ctx = output_canvas.getContext("2d");

    const preset_option = document.getElementById("preset-select");
    var preset = await load_preset(preset_option.selectedIndex);

    if (document.getElementById("preset-select").selectedIndex == document.getElementById("preset-select").children.length-1){
        // We have uploaded our own preset
        if (document.getElementById("preset_upload").files.length == 0){
            alert("You must upload a json file first.");
            return;
        }
        
        preset = await read_uploaded_json(document.getElementById("preset_upload").files[0]);
    }


    const palette = preset.colors;
    const bg_color = preset.background_color;
    var targetWidth = preset.targetWidth;
    var targetHeight = preset.targetHeight;

    if (targetWidth == -1 || targetHeight == -1)
    {
        targetWidth = input_canvas.width;
        targetHeight = input_canvas.height;
    }

    // 1. Get parent container size (in pixels)
    const parentStyle = getComputedStyle(output_parent);
    const maxParentWidth = parseInt(parentStyle.width);
    const maxParentHeight = parseInt(parentStyle.height);

    // 2. Calculate preset aspect ratio
    const aspect_target = targetWidth / targetHeight;

    // 3. Determine capped output size maintaining aspect ratio
    let outputWidth = targetWidth;
    let outputHeight = targetHeight;

    if (outputWidth > maxParentWidth || outputHeight > maxParentHeight) {
        // Scale down output canvas to fit within parent container
        const maxAspect = maxParentWidth / maxParentHeight;

        if (aspect_target > maxAspect) {
            // Width is limiting factor
            outputWidth = maxParentWidth;
            outputHeight = Math.round(outputWidth / aspect_target);
        } else {
            // Height is limiting factor
            outputHeight = maxParentHeight;
            outputWidth = Math.round(outputHeight * aspect_target);
        }
    }

    // 4. Set output canvas size
    output_canvas.width = outputWidth;
    output_canvas.height = outputHeight;

    // 5. Prepare temp canvas with preset target size (for dithering and processing)
    const tmpCanvas = document.createElement("canvas");
    const tmp_ctx = tmpCanvas.getContext("2d");
    tmpCanvas.width = targetWidth;
    tmpCanvas.height = targetHeight;

    // 6. Fit input_canvas image to preset target size (with aspect ratio)
    const aspect_input = input_canvas.width / input_canvas.height;
    let drawWidth, drawHeight;
    if (aspect_input > aspect_target) {
        drawWidth = targetWidth;
        drawHeight = targetWidth / aspect_input;
    } else {
        drawHeight = targetHeight;
        drawWidth = targetHeight * aspect_input;
    }
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;

    tmp_ctx.fillStyle = "rgb(" + bg_color[0].toString() + " " + bg_color[1].toString() + " " + bg_color[2].toString() + ")";
    tmp_ctx.fillRect(0, 0, targetWidth, targetHeight);
    tmp_ctx.drawImage(input_canvas, 0, 0, input_canvas.width, input_canvas.height, offsetX, offsetY, drawWidth, drawHeight);

    // 7. Image processing (palette mapping + dithering) on tmpCanvas data
    const imageData = tmp_ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imageData.data;

    let buffer = new Uint8ClampedArray(data);
    const width = targetWidth;
    const height = targetHeight;

    function findNearestcolor(r, g, b) {
        let nearest = palette[0];
        let minDist = Infinity;

        for (const color of palette) {
            const dr = r - color[0];
            const dg = g - color[1];
            const db = b - color[2];
            const dist = dr * dr + dg * dg + db * db;
            if (dist < minDist) {
                minDist = dist;
                nearest = color;
            }
        }
        return nearest;
    }

    function distributeError(x, y, err) {
        const weights = [
            [1, 0, 7 / 16],
            [-1, 1, 3 / 16],
            [0, 1, 5 / 16],
            [1, 1, 1 / 16]
        ];

        for (const [dx, dy, weight] of weights) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const i = (ny * width + nx) * 4;
                buffer[i] = Math.min(255, Math.max(0, buffer[i] + err[0] * weight));
                buffer[i + 1] = Math.min(255, Math.max(0, buffer[i + 1] + err[1] * weight));
                buffer[i + 2] = Math.min(255, Math.max(0, buffer[i + 2] + err[2] * weight));
            }
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = buffer[idx];
            const g = buffer[idx + 1];
            const b = buffer[idx + 2];

            const [nr, ng, nb] = findNearestcolor(r, g, b);
            const err = [r - nr, g - ng, b - nb];

            buffer[idx] = nr;
            buffer[idx + 1] = ng;
            buffer[idx + 2] = nb;

            distributeError(x, y, err);
        }
    }

    // 8. Create ImageData from full size palette-mapped data
    const outputDataFull = new ImageData(buffer, width, height);

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = width;
    fullCanvas.height = height;
    const fullCtx = fullCanvas.getContext("2d");
    fullCtx.putImageData(outputDataFull, 0, 0);

    // 9. Now, scale down to fit output canvas size (outputWidth x outputHeight)
    // Create a temporary canvas for scaling
    const scaleCanvas = document.createElement("canvas");
    scaleCanvas.width = width;
    scaleCanvas.height = height;
    const scaleCtx = scaleCanvas.getContext("2d");
    scaleCtx.putImageData(outputDataFull, 0, 0);

    // Clear output canvas and draw scaled image
    out_ctx.clearRect(0, 0, outputWidth, outputHeight);
    out_ctx.drawImage(scaleCanvas, 0, 0, width, height, 0, 0, outputWidth, outputHeight);

    window.fullOutputCanvas = fullCanvas;
    document.getElementById("fulldownload").style = "display:block";
}

function downloadFullImage()
{
    if(!window.fullOutputCanvas){
        alert("Please convert the image first.");
        return;
    }

    window.fullOutputCanvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "full_sized_image.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, "image/png");
}

async function reset()
{
    const input = document.getElementById("image_input");
    const base64 = await imageToBase64(input.files[0]);

    var img = new Image();
    img.onload = function()
    {
        var canvas = document.getElementById("original_image");
        var ctx = canvas.getContext("2d");
        
        ctx.fillStyle = "rgba(0 0 0 0)";
        ctx.fillRect(0,0,canvas.width, canvas.height);

        var imgWidth = img.naturalWidth;
        var imgHeight = img.naturalHeight;

        var aspect_canvas = canvas.width / canvas.height;
        var aspect_img = imgWidth / imgHeight;

        let drawWidth, drawHeight;

        if (aspect_img > aspect_canvas){
            drawWidth = canvas.width;
            drawHeight = canvas.width / aspect_img;
        } else {
            drawHeight = canvas.height;
            drawWidth = canvas.height * aspect_img;
        }

        canvas.width = drawWidth;
        canvas.height = drawHeight;

        ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0);
    }
    img.src = base64;
}