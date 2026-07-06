import onnx, torch, coremltools as ct
from onnx2torch import convert as from_onnx

ONNX = "SFace.onnx"
OUT  = "SFace.mlpackage"

m = from_onnx(onnx.load(ONNX)).eval()
ex = torch.rand(1, 3, 112, 112)
with torch.no_grad():
    print("output shape:", tuple(m(ex).shape))
traced = torch.jit.trace(m, ex)

mlmodel = ct.convert(
    traced,
    inputs=[ct.ImageType(name="image", shape=(1, 3, 112, 112),
                         scale=1.0, bias=[0.0, 0.0, 0.0],
                         color_layout=ct.colorlayout.BGR)],
    outputs=[ct.TensorType(name="embedding")],
    convert_to="mlprogram",
    minimum_deployment_target=ct.target.iOS15,
)
mlmodel.save(OUT)
print("saved", OUT)
